/**
 * fetch-iucn.js — run LOCALLY (not in CI) to populate cache/iucn.json
 *
 * Usage:
 *   IUCN_TOKEN=your_token node fetch-iucn.js
 *
 * Reads all YAML entries, looks up each species on IUCN Red List v3 API,
 * and writes results to cache/iucn.json.  Commit that file so the build
 * can use it without any network access to IUCN.
 */

import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";
import { load as parseYAML } from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, "data");
const CACHE_DIR = path.join(__dirname, "cache");
const OUT_FILE  = path.join(CACHE_DIR, "iucn.json");

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, json: null }); }
      });
    }).on("error", reject);
  });
}

function readAllSpecies() {
  // Species names come from NCBI enrichment, stored in cache/taxonomy.json
  const taxFile = path.join(__dirname, "cache", "taxonomy.json");
  if (!fs.existsSync(taxFile)) {
    console.error("cache/taxonomy.json not found — run a build first");
    return new Set();
  }
  const taxonomy = JSON.parse(fs.readFileSync(taxFile, "utf8"));
  return new Set(Object.values(taxonomy).map(t => t.species).filter(Boolean));
}

const token = process.env.IUCN_TOKEN;
if (!token) { console.error("Set IUCN_TOKEN env var"); process.exit(1); }

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const existing = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, "utf8")) : {};
const allSpecies = readAllSpecies();
console.log(`Found ${allSpecies.size} unique species`);

for (const name of allSpecies) {
  if (existing[name]) { console.log(`  (cached) ${name}`); continue; }
  const encoded = encodeURIComponent(name);
  const { status, json } = await httpGetJson(
    `https://apiv3.iucnredlist.org/api/v3/species/${encoded}?token=${token}`
  );
  if (status === 200 && json?.result?.length) {
    const r = json.result[0];
    existing[name] = {
      iucn_status:    r.category,
      iucn_pop_trend: r.population_trend,
      iucn_url:       `https://www.iucnredlist.org/species/${r.taxonid}`
    };
    console.log(`  ✅ ${name}: ${r.category} (${r.population_trend})`);
  } else {
    existing[name] = null; // mark as not found so we don't retry
    console.warn(`  ❌ ${name}: status ${status}`);
  }
  await new Promise(r => setTimeout(r, 500));
}

fs.writeFileSync(OUT_FILE, JSON.stringify(existing, null, 2), "utf8");
console.log(`\nWritten to cache/iucn.json (${Object.keys(existing).length} entries)`);
console.log("Now commit cache/iucn.json and push.");
