/**
 * Full build.js for wildEpiOmics - UPDATED WITH GBIF Fallback
 * - Loads YAML study entries
 * - Enriches with NCBI taxonomy (species, order, class, common name, image)
 * - FALLBACK: If NCBI missing class/order → GBIF species match API
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
// NCBI TAXONOMY (primary source)
// --------------------------------------------------------------
async function fetchTaxonMinimal(taxid, attempts = 3) {
  const url = `https://api.ncbi.nlm.nih.gov/datasets/v2/taxonomy/taxon/${taxid}`;
  for (let i = 0; i < attempts; i++) {
    try {
      const { status, json } = await httpGetJson(url);
      if (status === 200 && json?.taxonomy_nodes?.length) {
        return json.taxonomy_nodes[0].taxonomy;
      }
    } catch (e) {
      if (i === attempts - 1) throw e;
    }
    await new Promise((r) => setTimeout(r, 500 * (i + 1))); // backoff
  }
  return null;
}

// --------------------------------------------------------------
// GBIF Fallback API (ROBUST VERSION)
// --------------------------------------------------------------
async function fetchGBIFClassification(scientificName, attempts = 3) {
  if (!scientificName?.trim()) {
    console.log(`   ❌ GBIF: No scientific name provided`);
    return null;
  }
  
  const encodedName = encodeURIComponent(scientificName.trim());
  const url = `https://api.gbif.org/v1/species/match?name=${encodedName}`;
  
  console.log(`   🔄 GBIF fallback → ${url}`);
  
  for (let i = 0; i < attempts; i++) {
    try {
      const { status, json } = await httpGetJson(url);
      
      console.log(`   📡 GBIF response: status=${status}, usage=${json?.usage?.key || 'none'}`);
      
      if (status === 200 && json?.usage?.key && json.classification?.length > 0) {
        console.log(`   ✅ GBIF MATCHED: ${json.usage.canonicalName} (${json.classification.length} ranks)`);
        return json.classification;
      } else if (status !== 200) {
        console.log(`   ❌ GBIF HTTP ${status}`);
      } else {
        console.log(`   ❌ GBIF no match/empty classification`);
      }
    } catch (e) {
      console.log(`   ❌ GBIF ERROR ${i+1}/${attempts}: ${e.message}`);
      if (i === attempts - 1) {
        console.log(`   💡 TIP: Test manually: curl "https://api.gbif.org/v1/species/match?name=Caretta caretta"`);
      }
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  return null;
}

// --------------------------------------------------------------
// ENRICHED TAXONOMY with NCBI + GBIF fallback
// --------------------------------------------------------------
async function enrichTaxonomy(taxid) {
  const out = { species: null, order: null, class: null, common_name: null, source: "ncbi-heuristic" };
  const node = await fetchTaxonMinimal(taxid);
  if (!node) return out;

  console.log(`🔍 Processing ${taxid} (${node.organism_name})`);
  out.species = node.organism_name;
  out.common_name = node.genbank_common_name || node.common_name;

  const lineageIds = Array.isArray(node.lineage) ? node.lineage : [];
  let foundClass = null;
  let foundOrder = null;
  const allLineageNodes = [];

  // Collect ALL lineage nodes (your existing approach)
  for (let i = lineageIds.length - 2; i >= 0; i--) {
    const lt = lineageIds[i];
    if (lt < 10) continue;
    
    try {
      const ln = await fetchTaxonMinimal(lt);
      if (ln) allLineageNodes.push(ln);
    } catch (e) {
      continue;
    }
  }

  // 1. EXACT RANK MATCHES (works for Testudines ✓)
  foundOrder = allLineageNodes.find(ln => (ln.rank || '').toLowerCase() === 'order')?.organism_name;
  foundClass = allLineageNodes.find(ln => (ln.rank || '').toLowerCase() === 'class')?.organism_name;

  // 2. HEURISTIC: Class is the HIGHEST node between phylum & order
  if (!foundClass && foundOrder) {
    // Find phylum-level and order-level nodes
    const phylumNodes = allLineageNodes.filter(ln => (ln.rank || '').toLowerCase() === 'phylum');
    const orderNodes = allLineageNodes.filter(ln => ln.organism_name === foundOrder);
    
    if (phylumNodes.length > 0) {
      // Class = highest node between phylum & species (excludes unranked clades)
      const betweenPhylumAndOrder = allLineageNodes.filter(ln => 
        ln.tax_id > phylumNodes[0].tax_id && 
        allLineageNodes.findIndex(o => o.tax_id === ln.tax_id) < allLineageNodes.findIndex(o => o.organism_name === foundOrder)
      );
      
      // Use the HIGHEST (most inclusive) node as "class"
      if (betweenPhylumAndOrder.length > 0) {
        foundClass = betweenPhylumAndOrder[0].organism_name;  // Sauropsida
        console.log(`  ✅ HEURISTIC CLASS: ${foundClass} (phylum→order gap)`);
      }
    }
  }

  // 3. SEMANTIC FALLBACK: Standard class names in any rank
  if (!foundClass) {
    const classCandidates = allLineageNodes.filter(ln => 
      ['reptilia', 'aves', 'mammalia', 'amphibia', 'actinopterygii', 'chondrichthyes']
      .some(candidate => ln.organism_name.toLowerCase().includes(candidate))
    );
    if (classCandidates.length > 0) {
      foundClass = classCandidates[0].organism_name;
      console.log(`  ✅ SEMANTIC CLASS: ${foundClass}`);
    }
  }

  out.class = foundClass;
  out.order = foundOrder;
  console.log(`🎯 FINAL: order="${out.order}", class="${out.class}" (${out.source})`);
  return out;
}

// --------------------------------------------------------------
// BIBTEX GENERATION (unchanged)
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
    const id = csl.DOI ? csl.DOI.replace(/\\W+/g, "_") : "entry";
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

console.log("🧬 Enriching taxonomy (NCBI + GBIF fallback)...");
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
