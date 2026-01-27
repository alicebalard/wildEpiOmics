import fs from "fs";
import path from "path";
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

      if (Array.isArray(parsed)) {
        all.push(...parsed);
      } else {
        all.push(parsed);
      }
    } catch (err) {
      console.error(`❌ Failed parsing ${file}`);
      throw err;
    }
  }

  return all;
}

function copyFile(name) {
  const src = path.join(ROOT, name);
  const dest = path.join(DIST_DIR, name);

  if (!fs.existsSync(src)) return;
  fs.copyFileSync(src, dest);
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

console.log(`✅ Build complete: ${outPath}`);
console.log(`📊 Records loaded: ${data.length}`);
