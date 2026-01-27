import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";
import { load as parseYAML } from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DIST_DIR = path.join(ROOT, "dist");

// --------------------
// Helpers
// --------------------
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readAllData() {
  const all = [];
  if (!fs.existsSync(DATA_DIR)) return all;

  const files = fs.readdirSync(DATA_DIR);

  for (const file of files) {
    const full = path.join(DATA_DIR, file);
    const ext = path.extname(file).toLowerCase();

    if (![".yml", ".yaml", ".json"].includes(ext)) continue;

    const raw = fs.readFileSync(full, "utf8");

    try {
      const parsed =
        ext === ".json" ? JSON.parse(raw) : parseYAML(raw);
      all.push(parsed);
    } catch (err) {
      console.error(`❌ Failed parsing ${file}`);
      throw err;
    }
  }

  return all;
}

// Fetch BibTeX
async function fetchBibtex(doi) {
  const url = `https://doi.org/${encodeURIComponent(doi)}`;
  return new Promise((resolve, reject) => {
    const opts = {
      headers: {
        Accept: "application/x-bibtex"
      }
    };

    https.get(url, opts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data.trim()));
    }).on("error", reject);
  });
}

async function buildBibtexMap(data) {
  const map = {};
  for (const entry of data) {
    if (!entry.doi) continue;
    try {
      map[entry.doi] = await fetchBibtex(entry.doi);
    } catch (err) {
      console.warn("⚠️ Failed to fetch BibTeX for", entry.doi);
    }
  }
  return map;
}

function copyFile(name) {
  const src = path.join(ROOT, name);
  const dest = path.join(DIST_DIR, name);

  if (fs.existsSync(src)) fs.copyFileSync(src, dest);
}

// --------------------
// Build
// --------------------
console.log("🔨 Building site...");

ensureDir(DIST_DIR);

// Load template
const templatePath = path.join(ROOT, "template.html");
let html = fs.readFileSync(templatePath, "utf8");

// Load data
const data = readAllData();

// Build bibtex.json
console.log("📚 Fetching BibTeX records…");
const bibMap = await buildBibtexMap(data);

// Write out bibtex.json into PUBLIC (source) directory
ensureDir(path.join(ROOT, "public"));
fs.writeFileSync(
  path.join(ROOT, "public", "bibtex.json"),
  JSON.stringify(bibMap, null, 2),
  "utf8"
);

// Inject data
const injection = `
<script>
window.__DATA__ = ${JSON.stringify(data, null, 2)};
</script>
`;

html = html.replace("<!-- INJECT_DATA -->", injection);

// Write output
const outPath = path.join(DIST_DIR, "index.html");
fs.writeFileSync(outPath, html, "utf8");

// Copy assets
copyFile("style.css");
copyFile("script.js");

// Copy public folder contents
ensureDir(path.join(DIST_DIR, "public"));
for (const f of fs.readdirSync(path.join(ROOT, "public"))) {
  fs.copyFileSync(
    path.join(ROOT, "public", f),
    path.join(DIST_DIR, "public", f)
  );
}

console.log(`✅ Build complete: ${outPath}`);
console.log(`📊 Records loaded: ${data.length}`);
``
