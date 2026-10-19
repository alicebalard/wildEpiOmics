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

// -----------------
// NCBI TAXONOMY 
// -----------------
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

// ---------------------------------
// ENRICHED TAXONOMY with NCBI 
// ---------------------------------
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

  // Collect lineage (unchanged)
  for (let i = lineageIds.length - 2; i >= 0; i--) {
    const lt = lineageIds[i];
    if (lt < 10) continue;
    try {
      const ln = await fetchTaxonMinimal(lt);
      if (ln) allLineageNodes.push(ln);
    } catch (e) {}
  }

  // EXACT RANK MATCHES first
  foundOrder = allLineageNodes.find(ln => (ln.rank || '').toLowerCase() === 'order')?.organism_name;
  foundClass = allLineageNodes.find(ln => (ln.rank || '').toLowerCase() === 'class')?.organism_name;
	
// Hardcoded for when NCBI doesn't find the correct class/order (to add manually as it goes):
if (!foundClass && foundOrder === 'Testudines') {
  foundClass = 'Reptilia';
  console.log(`  ✅ MANUAL OVERRIDE`);
}
if (!foundClass && foundOrder === 'Crocodylia') {
  foundClass = 'Reptilia';
  console.log(`  ✅ MANUAL OVERRIDE`);
}
out.class = foundClass;
out.order = foundOrder;
	
  console.log(`🎯 FINAL: order="${out.order}", class="${out.class}" (${out.source})`);
  return out;
}

// -----------------
// IUCN: conservation status
// -----------------
async function enrichIUCN(speciesName) {
  const token = process.env.IUCN_TOKEN;
  if (!token || !speciesName) return {};

  try {
    const name = encodeURIComponent(speciesName);
    // Step A: find the species internal ID
    const { status: s1, json: j1 } = await httpGetJson(
      `https://api.iucnredlist.org/api/v4/taxa/scientific_name/${name}`,
      { headers: { Authorization: `Token ${token}` } }
    );
    if (s1 !== 200 || !j1?.taxon?.sis_id) return {};
    const sisId = j1.taxon.sis_id;

    // Step B: get the latest conservation assessment
    const { status: s2, json: j2 } = await httpGetJson(
      `https://api.iucnredlist.org/api/v4/taxa/${sisId}/assessments/latest`,
      { headers: { Authorization: `Token ${token}` } }
    );
    if (s2 !== 200 || !j2?.assessment) return {};
    const a = j2.assessment;

    return {
      iucn_status:    a.red_list_category?.code,       // e.g. "LC", "VU", "EN"
      iucn_pop_trend: a.population_trend?.description, // e.g. "Decreasing"
      iucn_url:       `https://www.iucnredlist.org/species/${sisId}`
    };
  } catch (e) {
    console.warn(`IUCN failed for ${speciesName}:`, e.message);
    return {};
  }
}

// -----------------
// Wikipedia: species image
// -----------------
async function fetchWikipediaImage(speciesName) {
  if (!speciesName) return {};
  try {
    const name = encodeURIComponent(speciesName.replace(/ /g, '_'));
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${name}`;
    const { status, json } = await httpGetJson(url);
    if (status === 200 && json?.thumbnail?.source) {
      // Get full-size image instead of thumbnail
      const fullImage = json.originalimage?.source || json.thumbnail.source;
      return {
        image: fullImage,
        image_credit: `© Wikimedia Commons`
      };
    }
  } catch (e) {
    console.warn(`Wikipedia image failed for ${speciesName}:`, e.message);
  }
  return {};
}

console.log("🔴 Fetching IUCN status...");
console.log("🖼️  Fetching Wikipedia images...");
for (const entry of data) {
  if (entry.species) {
    // IUCN status
    const iucn = await enrichIUCN(entry.species);
    if (iucn.iucn_status)    entry.iucn_status    = iucn.iucn_status;
    if (iucn.iucn_pop_trend) entry.iucn_pop_trend = iucn.iucn_pop_trend;
    if (iucn.iucn_url)       entry.iucn_url        = iucn.iucn_url;

    // Wikipedia image — only if no image was set manually in the YAML
    if (!entry.image) {
      const wiki = await fetchWikipediaImage(entry.species);
      if (wiki.image) {
        entry.image        = wiki.image;
        entry.image_credit = wiki.image_credit;
      }
    }

    await new Promise(r => setTimeout(r, 300)); // small pause between requests
  }
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

// Duplicate check: same taxid + data_url
const seen = new Map();
for (const entry of data) {
  const key = `${entry.taxid}||${(entry.data_url || '').trim()}`;
  if (seen.has(key)) {
    console.warn(`⚠️  DUPLICATE: taxid=${entry.taxid}, data_url=${entry.data_url}`);
    console.warn(`   First seen in doi: ${seen.get(key).doi}`);
    console.warn(`   Duplicate doi:     ${entry.doi}`);
  } else {
    seen.set(key, entry);
  }
}

console.log("🧬 Enriching taxonomy (NCBI)...");
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
