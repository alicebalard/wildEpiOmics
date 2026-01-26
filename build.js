// build.js
// Build script: reads data/*.yaml, enriches with NCBI taxonomy (species/order/class),
// fetches BibTeX via DOI content negotiation, and emits index.html + caches.
// Requirements: Node 20+ (fetch available), dependencies in package.json.

import fs from 'fs';
import path from 'path';
import { parse as parseYAML } from 'js-yaml';
import { XMLParser } from 'fast-xml-parser';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const CACHE_DIR = path.join(__dirname, 'cache');
const PUBLIC_DIR = path.join(__dirname, 'public');
const TEMPLATE = path.join(__dirname, 'template.html');
const OUT_HTML = path.join(__dirname, 'index.html');
const TAX_CACHE = path.join(CACHE_DIR, 'taxonomy.json');
const BIB_CACHE = path.join(PUBLIC_DIR, 'bibtex.json');

fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', allowBooleanAttributes: true });

// Identify ourselves to NCBI as recommended in E-utilities guidance
// https://eutils.ncbi.nlm.nih.gov/entrez/eutils/  (usage guideline: <= 3 req/s)
const EUTILS_TOOL = 'biodiversity-study-catalog';
const EUTILS_EMAIL = 'noreply@example.org'; // <-- replace with a group email if desired
const USER_AGENT = 'biodiversity-study-catalog/1.0 (+https://github.com/<your-org>/<your-repo>)';

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function loadJSON(fp, fallback) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fallback; }
}
function saveJSON(fp, obj) {
  fs.writeFileSync(fp, JSON.stringify(obj, null, 2));
}

const taxCache = loadJSON(TAX_CACHE, {});
const bibCache = loadJSON(BIB_CACHE, {});

function pickRank(lineage, target) {
  if (!Array.isArray(lineage)) return '';
  const t = String(target).toLowerCase();
  for (const node of lineage) {
    const rank = String(node.Rank || node.rank || '').toLowerCase();
    if (rank === t) return node.ScientificName || node.scientificname || '';
  }
  return '';
}

async function fetchNCBITaxonomy(taxid) {
  if (taxCache[taxid]) return taxCache[taxid];

  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=taxonomy&id=${encodeURIComponent(taxid)}&retmode=xml&tool=${encodeURIComponent(EUTILS_TOOL)}&email=${encodeURIComponent(EUTILS_EMAIL)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`NCBI efetch failure ${res.status}`);
  const xml = await res.text();
  const doc = xmlParser.parse(xml);

  // Expected shape: TaxaSet > Taxon
  let taxon = doc?.TaxaSet?.Taxon;
  if (Array.isArray(taxon)) taxon = taxon[0];

  const sci = taxon?.ScientificName || '';
  let lineageEx = taxon?.LineageEx?.Taxon || [];
  if (!Array.isArray(lineageEx)) lineageEx = [lineageEx];

  const species = pickRank(lineageEx, 'species') || sci;
  const order = pickRank(lineageEx, 'order') || '';
  const klass = pickRank(lineageEx, 'class') || '';

  const result = { species, order, class: klass };
  taxCache[taxid] = result;

  // Throttle ~3 req/s as per guidance
  await sleep(350);
  return result;
}

async function fetchBibtex(doi) {
  if (bibCache[doi]) return bibCache[doi];

  const doiURL = `https://doi.org/${encodeURIComponent(doi)}`;
  let res = await fetch(doiURL, { headers: { 'Accept': 'application/x-bibtex; charset=utf-8' } });
  if (!res.ok) {
    // Fallback to Crossref /transform endpoint if available
    const crURL = `https://api.crossref.org/v1/works/${encodeURIComponent(doi)}/transform`;
    res = await fetch(crURL, { headers: { 'Accept': 'application/x-bibtex; charset=utf-8' } });
  }
  if (!res.ok) throw new Error(`BibTeX fetch failed for ${doi}: ${res.status}`);
  const bib = (await res.text()).trim();
  bibCache[doi] = bib;
  await sleep(200);
  return bib;
}

function readEntries() {
  const files = fs.readdirSync(DATA_DIR).filter(f => /\.ya?ml$/i.test(f));
  const out = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(DATA_DIR, f), 'utf8');
    const y = parseYAML(raw);
    const req = ['doi','taxid','individuals','data_url','method'];
    const ok = req.every(k => y && Object.prototype.hasOwnProperty.call(y,k));
    if (!ok) { console.warn(`Skipping ${f} (missing one of ${req.join(', ')})`); continue; }
    out.push({ ...y, _file: f });
  }
  return out;
}

function injectData(templateStr, payload) {
  const marker = '<!-- INJECT_DATA -->';
  const json = `<script id="entries" type="application/json">${JSON.stringify(payload)}</script>`;
  if (templateStr.includes(marker)) return templateStr.replace(marker, json);
  // If marker missing, append before closing body
  return templateStr.replace('</body>', json + '\n</body>');
}

function sortEntries(arr) {
  return arr.sort((a,b)=>{
    const ka = `${a.class||''}\u0001${a.order||''}\u0001${a.species||''}\u0001${a.doi}`.toLowerCase();
    const kb = `${b.class||''}\u0001${b.order||''}\u0001${b.species||''}\u0001${b.doi}`.toLowerCase();
    return ka.localeCompare(kb);
  });
}

(async function main(){
  const entries = readEntries();

  for (const e of entries) {
    try {
      const t = await fetchNCBITaxonomy(e.taxid);
      Object.assign(e, t);
    } catch (err) {
      console.error(`Taxonomy error for ${e.taxid} (${e._file}):`, err.message);
    }
    try {
      await fetchBibtex(e.doi);
    } catch (err) {
      console.error(`BibTeX error for ${e.doi} (${e._file}):`, err.message);
    }
  }

  // Persist caches
  saveJSON(TAX_CACHE, taxCache);
  saveJSON(BIB_CACHE, bibCache);

  const sorted = sortEntries(entries);
  const payload = { generatedAt: new Date().toISOString(), entries: sorted };

  const template = fs.readFileSync(TEMPLATE, 'utf8');
  const outHTML = injectData(template, payload);
  fs.writeFileSync(OUT_HTML, outHTML, 'utf8');

  console.log(`Built ${sorted.length} entries → ${OUT_HTML}`);
})();
