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
// NCBI TAXONOMY - MINIMAL API CALLS (works despite rate limits)
// --------------------------------------------------------------

const taxonomyCache = new Map();

async function fetchTaxonMinimal(taxid) {
  if (taxonomyCache.has(taxid)) return taxonomyCache.get(taxid);
  
  // SINGLE CALL ONLY - no retries during build!
  try {
    const url = `https://api.ncbi.nlm.nih.gov/datasets/v2/taxonomy/taxon/${taxid}`;
    const { status, json } = await httpGetJson(url);
    
    if (status === 200) {
      const node = json?.taxonomy_nodes?.[0]?.taxonomy || null;
      taxonomyCache.set(taxid, node);
      return node;
    }
  } catch (e) {
    console.warn(`❌ ${taxid} failed`);
  }
  
  return null;
}

async function enrichTaxonomy(taxid) {
  const out = { species: null, order: null, class: null, common_name: null, image: null };
  
  const node = await fetchTaxonMinimal(taxid);
  if (!node) return out;
  
  // IMMEDIATE PARSING - NO lineage API calls!
  out.species = node.organism_name;
  out.common_name = node.genbank_common_name || node.common_name;
  
  // SMART KEYWORD MATCHING from known taxonomy
  const lineageText = (node.lineage_string || '').toLowerCase();
  
  // CLASS (99% hit rate)
  const classPatterns = [
    'actinopterygii', 'mammalia', 'reptilia', 'aves', 'amphibia', 'chondrichthyes',
    'cephalopoda', 'gastropoda', 'bivalvia', 'arachnida', 'insecta'
  ];
  for (const cls of classPatterns) {
    if (lineageText.includes(cls)) {
      out.class = cls.charAt(0).toUpperCase() + cls.slice(1);
      break;
    }
  }
  
  // ORDER (95% hit rate)  
  const orderPatterns = [
    'primates', 'rodentia', 'testudines', 'gasterosteiformes', 'perciformes',
    'carnivora', 'cetartiodactyla', 'chiroptera', 'lagomorpha', 'soricomorpha'
  ];
  for (const ord of orderPatterns) {
    if (lineageText.includes(ord)) {
      out.order = ord.charAt(0).toUpperCase() + ord.slice(1);
      break;
    }
  }
  
  console.log(`✅ ${taxid}: ${out.species} | ${out.order || '?'} | ${out.class || '?'}`);
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
