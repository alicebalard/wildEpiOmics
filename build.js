/**
 * Full build.js for wildEpiOmics
 * - Loads YAML study entries
 * - Enriches with NCBI taxonomy (species, order, class, common name, image)
 * - Fetches BibTeX with Crossref + CSL-JSON fallback
 * - Writes public/bibtex.json
 * - Injects window.__DATA__ into template.html
 * - Outputs complete static site into dist/
 */

import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";
import { load as parseYAML } from "js-yaml";

// --------------------------------------------------------------
// PATH SETUP
// --------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const PUBLIC_DIR = path.join(ROOT, "public");
const DIST_DIR = path.join(ROOT, "dist");

// --------------------------------------------------------------
// HELPERS
// --------------------------------------------------------------
function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readAllData() {
    const all = [];
    if (!fs.existsSync(DATA_DIR)) return all;

    for (const file of fs.readdirSync(DATA_DIR)) {
	const ext = path.extname(file).toLowerCase();
	if (![".yaml", ".yml", ".json"].includes(ext)) continue;

	try {
	    const content = fs.readFileSync(path.join(DATA_DIR, file), "utf8");
	    const parsed = ext === ".json" ? JSON.parse(content) : parseYAML(content);
	    all.push(parsed);
	} catch (err) {
	    console.error("❌ Failed parsing", file, err);
	}
    }
    return all;
}

// Simple GET returning text
function httpGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
	https.get(url, { headers }, (res) => {
	    let data = "";
	    res.on("data", (chunk) => (data += chunk));
	    res.on("end", () => resolve(data));
	}).on("error", reject);
    });
}

// GET expecting JSON
function httpGetJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let json = null;
        try {
          json = data ? JSON.parse(data) : null;
        } catch (e) {
          // Non‑JSON error responses will land here
          return reject(
            new Error(`Invalid JSON from ${url} (status ${res.statusCode})`)
          );
        }
        resolve({ status: res.statusCode, json });
      });
    });

    req.on("error", reject);

    if (options.body) req.write(options.body);
    req.end();
  });
}

// --------------------------------------------------------------
// NCBI TAXONOMY ENRICHMENT - OPTIMIZED (1 API call per species)
// --------------------------------------------------------------

// In-memory cache for this build run
const taxonomyCache = new Map();

async function fetchTaxonWithRetry(taxid, retries = 3) {
  if (taxonomyCache.has(taxid)) return taxonomyCache.get(taxid);

  let delay = 500;
  for (let i = 0; i < retries; i++) {
    try {
      // TRY LINEAGE ENDPOINT FIRST (1 call = full lineage!)
      const lineageUrl = `https://api.ncbi.nlm.nih.gov/datasets/v2/taxonomy/lineage/${taxid}`;
      let { status, json } = await httpGetJson(lineageUrl);
      
      if (status === 200 && json?.taxonomy_nodes?.[0]) {
        const node = json.taxonomy_nodes[0].taxonomy;
        taxonomyCache.set(taxid, node);
        return node;
      }

      // FALLBACK: Single taxon endpoint
      const url = `https://api.ncbi.nlm.nih.gov/datasets/v2/taxonomy/taxon/${taxid}`;
      const fallback = await httpGetJson(url);
      
      if (fallback.status === 429) {
        console.warn("Rate limited for", taxid, "retry", i + 1);
      } else if (fallback.status !== 200) {
        console.warn("Taxonomy HTTP error", taxid, fallback.status);
        taxonomyCache.set(taxid, null);
        return null;
      }

      const node = fallback.json?.taxonomy_nodes?.[0]?.taxonomy || null;
      taxonomyCache.set(taxid, node);
      return node;
      
    } catch (e) {
      console.warn("Taxonomy request failed for", taxid, e.message);
    }

    // Exponential backoff
    await new Promise((r) => setTimeout(r, delay));
    delay *= 2;
  }
  
  taxonomyCache.set(taxid, null);
  return null;
}

async function enrichTaxonomy(taxid) {
  const out = {
    species: null,
    order: null, 
    class: null,
    common_name: null,
    image: null
  };

  try {
    const node = await fetchTaxonWithRetry(taxid);
    if (!node) {
      console.warn("No taxonomy found for", taxid);
      return out;
    }

    // Basic info from main node
    out.species = node.organism_name || null;
    out.common_name = node.genbank_common_name || node.common_name || null;

    // METHOD 1: Try lineage_string parsing (NO extra API calls!)
	  if (node.lineage_string) {
  const lineageParts = node.lineage_string.split(' > ').map(s => s.trim());
  
  // Walk from deepest (species) to root
  for (let i = lineageParts.length - 1; i >= 0; i--) {
    const name = lineageParts[i].toLowerCase();
    
    // CLASS patterns (more comprehensive)
    if (!out.class && (
      name.includes('class') || 
      name.includes('actinopterygii') || 
      name.includes('mammalia') || 
      name.includes('reptilia') ||
      name.includes('aves') ||
      name.includes('amphibia')
    )) {
      out.class = lineageParts[i];
    }
    
    // ORDER patterns  
    if (!out.order && (
      name.includes('order') ||
      name.includes('gasterosteiformes') ||
      name.includes('primates') ||
      name.includes('testudines') ||
      name.includes('rodentia')
    )) {
      out.order = lineageParts[i];
    }
    
    if (out.class && out.order) break;
  }
}
    // METHOD 2: Fallback to lineage IDs (only if needed)
    if (!out.class && !out.order && Array.isArray(node.lineage)) {
      // Just check 10 most recent ancestors (not full 50!)
      const recentIds = node.lineage.slice(-10).map(id => String(id));
      
      for (const id of recentIds) {
        if (taxonomyCache.has(id)) {
          const ancestor = taxonomyCache.get(id);
          const rank = (ancestor?.rank || '').toUpperCase();
          if (rank === 'CLASS') out.class = ancestor.organism_name;
          if (rank === 'ORDER') out.order = ancestor.organism_name;
          if (out.class && out.order) break;
        }
      }
    }

  } catch (err) {
    console.warn("❗ Taxonomy enrichment failed for", taxid, err.message);
  }

  return out;
}

// --------------------------------------------------------------
// BIBTEX GENERATION (Crossref + CSL fallback)
// --------------------------------------------------------------
async function fetchBibtex(doi) {
    // 1. Try Crossref BibTeX
    try {
	const url = `https://api.crossref.org/works/${encodeURIComponent(
      doi
    )}/transform/application/x-bibtex`;
	const bib = await httpGet(url);
	if (bib && !bib.startsWith("<")) return bib.trim();
    } catch {
	console.warn("Crossref BibTeX failed for", doi);
    }

    // 2. Try CSL JSON fallback
    try {
	const csl = await httpGetJson(`https://doi.org/${encodeURIComponent(doi)}`, {
	    Accept: "application/vnd.citationstyles.csl+json"
	});
	return cslToBibtex(csl);
    } catch {
	console.warn("CSL fallback failed for", doi);
    }

    return "";
}

function cslToBibtex(csl) {
    const id = csl.DOI ? csl.DOI.replace(/\W+/g, "_") : "entry";
    const authors = (csl.author || [])
	  .map((a) => `${a.family || ""}, ${a.given || ""}`.trim())
	  .join(" and ");
    const year = csl.issued?.["date-parts"]?.[0]?.[0] || "";
    return `
@article{${id},
  title = {${csl.title || ""}},
  author = {${authors}},
  journal = {${csl["container-title"] || ""}},
  year = {${year}},
  volume = {${csl.volume || ""}},
  number = {${csl.issue || ""}},
  pages = {${csl.page || ""}},
  doi = {${csl.DOI || ""}}
}`.trim();
}

async function buildBibtexMap(data) {
    const map = {};
    for (const entry of data) {
	if (!entry.doi) continue;
	map[entry.doi] = await fetchBibtex(entry.doi);
    }
    return map;
}

// --------------------------------------------------------------
// BUILD PROCESS
// --------------------------------------------------------------
console.log("🔨 Building site...");

// 1. Load YAML entries
const data = readAllData();

// Load/save taxonomy cache
const TAX_CACHE = path.join(ROOT, 'cache', 'taxonomy.json');
ensureDir(path.dirname(TAX_CACHE));

let cache = {};
if (fs.existsSync(TAX_CACHE)) {
    cache = JSON.parse(fs.readFileSync(TAX_CACHE, 'utf8'));
}

async function getCachedTaxonomy(taxid) {
    if (cache[taxid]) {
        console.log(`📦 Cache hit: ${taxid}`);
        return cache[taxid];
    }
    
    const result = await enrichTaxonomy(taxid);
    cache[taxid] = result;
    fs.writeFileSync(TAX_CACHE, JSON.stringify(cache, null, 2));
    return result;
}

// Then use it:
for (const entry of data) {
    if (entry.taxid) {
        const extra = await getCachedTaxonomy(entry.taxid);  // Uses cache!
        Object.assign(entry, extra);
    }
}

// 2. Enrich with taxonomy
console.log("🧬 Enriching taxonomy…");
for (const entry of data) {
    if (entry.taxid) {
	const extra = await enrichTaxonomy(entry.taxid);
	Object.assign(entry, extra);
    }
}

// 3. Build BibTeX map
console.log("📚 Fetching BibTeX…");
ensureDir(PUBLIC_DIR);
const bibMap = await buildBibtexMap(data);
fs.writeFileSync(
    path.join(PUBLIC_DIR, "bibtex.json"),
    JSON.stringify(bibMap, null, 2),
    "utf8"
);

// 4. Prepare dist directory
ensureDir(DIST_DIR);
ensureDir(path.join(DIST_DIR, "public"));

// 5. Read template and inject JS data
let html = fs.readFileSync(path.join(ROOT, "template.html"), "utf8");

console.log("ENRICHED DATA PREVIEW", JSON.stringify(data, null, 2));


html = html.replace(
    "<!-- INJECT_DATA -->",
    `<script>window.__DATA__ = ${JSON.stringify(data, null, 2)};</script>`
);

fs.writeFileSync(path.join(DIST_DIR, "index.html"), html, "utf8");

// 6. Copy assets
for (const f of ["style.css", "script.js"]) {
    if (fs.existsSync(path.join(ROOT, f))) {
	fs.copyFileSync(path.join(ROOT, f), path.join(DIST_DIR, f));
    }
}

// 7. Copy public/ folder
if (fs.existsSync(PUBLIC_DIR)) {
    for (const f of fs.readdirSync(PUBLIC_DIR)) {
	fs.copyFileSync(
	    path.join(PUBLIC_DIR, f),
	    path.join(DIST_DIR, "public", f)
	);
    }
}

console.log("✅ Build complete!");
console.log(`📊 Entries: ${data.length}`);
console.log(`📚 BibTeX entries: ${Object.keys(bibMap).length}`);
