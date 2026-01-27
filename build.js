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
  const url = `https://doi.org/${encodeURIComponent(doi)}`;
  return new Promise((resolve, reject) => {
    const opts = { headers: { Accept: "application/x-bibtex" } };
    https.get(url, opts, (res) => {
      let out = "";
      res.on("data", (chunk) => (out += chunk));
      res.on("end", () => resolve(out.trim()));
    }).on("error", reject);
  });
}

async function buildBibtexMap(data) {
  const map = {};
  for (const entry of data) {
    if (!entry.doi) continue;
    try {
      map[entry.doi] = await fetchBibtex(entry.doi);
    } catch {
      console.warn("⚠️ Could not fetch BibTeX for", entry.doi);
    }
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
