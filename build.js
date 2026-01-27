import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";
import { load as parseYAML } from "js-yaml";

// --------------------
// Setup paths
// --------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DIST_DIR = path.join(ROOT, "dist");
const PUBLIC_DIR = path.join(ROOT, "public");

// --------------------
// Helpers
// --------------------
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readAllData() {
  const all = [];
  if (!fs.existsSync(DATA_DIR)) return all;
  const files = fs.readdirSync(DATA_DIR);

  for (const file of files) {
    const full = path.join(DATA_DIR, file);
    const ext = path.extname(file).toLowerCase();
    if (![".yml", ".yaml", ".json"].includes(ext)) continue;

    try {
      const raw = fs.readFileSync(full, "utf8");
      const parsed = ext === ".json" ? JSON.parse(raw) : parseYAML(raw);
      all.push(parsed);
    } catch (err) {
      console.error("❌ Failed parsing", file, err);
    }
  }

  return all;
}

// --------------------
// BibTeX helpers
// --------------------
async function fetchBibtex(doi) {
  // 1. Try Crossref BibTeX
  const crossrefUrl = `https://api.crossref.org/works/${encodeURIComponent(doi)}/transform/application/x-bibtex`;

  try {
    const bib = await httpGetSimple(crossrefUrl);
    if (bib && !bib.startsWith("<")) return bib.trim();
  } catch (err) {
    console.warn("Crossref BibTeX failed for", doi);
  }

  // 2. Try generic DOI → CSL JSON
  try {
    const csl = await httpGetJson(
      `https://doi.org/${encodeURIComponent(doi)}`,
      { Accept: "application/vnd.citationstyles.csl+json" }
    );
    if (csl) return cslToBibtex(csl);
  } catch (err) {
    console.warn("CSL JSON fallback failed for", doi);
  }

  console.warn("⚠️ Could not generate BibTeX for", doi);
  return "";
}

// Basic GET for text responses
function httpGetSimple(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

// GET + parse JSON
function httpGetJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    }).on("error", reject);
  });
}

// 3. Convert CSL JSON → BibTeX
function cslToBibtex(csl) {
  const id = csl.DOI ? csl.DOI.replace(/\//g, "_") : "entry";
  const authors = (csl.author || [])
    .map(a => `${a.family || ""}, ${a.given || ""}`.trim())
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
}
`.trim();
}

async function buildBibtexMap(data) {
  const map = {};
  for (const entry of data) {
    if (!entry.doi) continue;
    map[entry.doi] = await fetchBibtex(entry.doi);
  }
  return map;
}

// --------------------
// Build
// --------------------
console.log("🔨 Building site...");

// Read YAML
const data = readAllData();

// Build BibTeX
console.log("📚 Fetching BibTeX…");
const bibMap = await buildBibtexMap(data);

// Ensure output dirs
ensureDir(DIST_DIR);
ensureDir(PUBLIC_DIR);
ensureDir(path.join(DIST_DIR, "public"));

// Write bibtex.json in public/
fs.writeFileSync(
  path.join(PUBLIC_DIR, "bibtex.json"),
  JSON.stringify(bibMap, null, 2),
  "utf8"
);

// Load HTML template
const template = fs.readFileSync(path.join(ROOT, "template.html"), "utf8");

// Inject DATA
const injected = template.replace(
  "<!-- INJECT_DATA -->",
  `<script>window.__DATA__ = ${JSON.stringify(data, null, 2)};</script>`
);

// Write dist/index.html
fs.writeFileSync(path.join(DIST_DIR, "index.html"), injected);

// Copy assets
for (const asset of ["script.js", "style.css"]) {
  const src = path.join(ROOT, asset);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(DIST_DIR, asset));
}

// Copy public/*
if (fs.existsSync(PUBLIC_DIR)) {
  for (const f of fs.readdirSync(PUBLIC_DIR)) {
    fs.copyFileSync(
      path.join(PUBLIC_DIR, f),
      path.join(DIST_DIR, "public", f)
    );
  }
}

console.log("✅ Build finished");
console.log("📊 Data entries:", data.length);
console.log("📚 BibTeX entries:", Object.keys(bibMap).length);
