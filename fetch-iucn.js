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

function httpGetJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, options, (res) => {
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
  try {
    // Step 1: get sis_id from species name
    const r1 = await httpGetJson(
      `https://api.iucnredlist.org/api/v4/taxa/scientific_name/${encoded}`,
      { headers: { Authorization: `Token ${token}` } }
    );
    if (r1.status !== 200 || !r1.json?.taxon?.sis_id) {
      console.warn(`  ❌ ${name}: step1 status ${r1.status}`);
      existing[name] = null;
      await new Promise(r => setTimeout(r, 300));
      continue;
    }
    const sisId = r1.json.taxon.sis_id;

    // Step 2: get latest assessment
    const r2 = await httpGetJson(
      `https://api.iucnredlist.org/api/v4/taxa/${sisId}/assessments/latest`,
      { headers: { Authorization: `Token ${token}` } }
    );
    if (r2.status !== 200 || !r2.json?.assessment) {
      console.warn(`  ❌ ${name}: step2 status ${r2.status}`);
      existing[name] = null;
      await new Promise(r => setTimeout(r, 300));
      continue;
    }
    const a = r2.json.assessment;
    existing[name] = {
      iucn_status:    a.red_list_category?.code,
      iucn_pop_trend: a.population_trend?.description,
      iucn_url:       `https://www.iucnredlist.org/species/${sisId}`
    };
    console.log(`  ✅ ${name}: ${existing[name].iucn_status} (${existing[name].iucn_pop_trend})`);
  } catch (e) {
    console.warn(`  ❌ ${name}: ${e.message}`);
    existing[name] = null;
  }
  await new Promise(r => setTimeout(r, 500));
}

fs.writeFileSync(OUT_FILE, JSON.stringify(existing, null, 2), "utf8");
console.log(`\nWritten to cache/iucn.json (${Object.keys(existing).length} entries)`);
console.log("Now commit cache/iucn.json and push.");
