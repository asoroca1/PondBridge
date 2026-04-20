#!/usr/bin/env node
/**
 * Seed the `city_geo` reference table from GeoNames cities1000.
 *
 * Sources (CC-BY 4.0): https://download.geonames.org/export/dump/
 *   - cities1000.zip      (all cities with population >= 1,000)
 *   - admin1CodesASCII.txt (ISO region codes -> region name)
 *
 * Usage:
 *   node scripts/seedCityGeo.mjs                    # downloads + imports
 *   node scripts/seedCityGeo.mjs --file=/path.txt   # uses a local cities1000.txt
 *   node scripts/seedCityGeo.mjs --min-pop=5000     # raises population threshold
 *   node scripts/seedCityGeo.mjs --dry              # parse only, no DB writes
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import { getSupabaseAdmin } from "../src/db/supabaseAdmin.js";
import { cityKey } from "../src/utils/geocode.js";

dotenv.config({ path: new URL("../.env", import.meta.url).pathname });

const CITIES_URL = "https://download.geonames.org/export/dump/cities1000.zip";
const ADMIN1_URL = "https://download.geonames.org/export/dump/admin1CodesASCII.txt";
const BATCH_SIZE = 500;

function parseArgs(argv) {
  const args = { file: "", minPop: 1000, dry: false };
  for (const raw of argv.slice(2)) {
    if (raw === "--dry") args.dry = true;
    else if (raw.startsWith("--file=")) args.file = raw.slice("--file=".length);
    else if (raw.startsWith("--min-pop=")) args.minPop = Number(raw.slice("--min-pop=".length)) || 1000;
  }
  return args;
}

function ensureCli(cmd) {
  const result = spawnSync("which", [cmd], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Required CLI "${cmd}" not found on PATH`);
  }
}

async function downloadFile(url, dest) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed ${response.status}: ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(dest, buffer);
}

async function fetchAdmin1Map(workDir) {
  const target = path.join(workDir, "admin1CodesASCII.txt");
  console.log(`→ Downloading ${ADMIN1_URL}`);
  await downloadFile(ADMIN1_URL, target);
  const map = new Map();
  const text = fs.readFileSync(target, "utf8");
  for (const line of text.split("\n")) {
    if (!line) continue;
    const [code, name] = line.split("\t");
    if (code && name) map.set(code.trim(), name.trim());
  }
  return map;
}

async function resolveCitiesFile(argFile, workDir) {
  if (argFile) {
    if (!fs.existsSync(argFile)) throw new Error(`--file not found: ${argFile}`);
    return argFile;
  }
  ensureCli("unzip");
  const zipPath = path.join(workDir, "cities1000.zip");
  console.log(`→ Downloading ${CITIES_URL}`);
  await downloadFile(CITIES_URL, zipPath);
  console.log(`→ Unzipping`);
  const result = spawnSync("unzip", ["-o", zipPath, "-d", workDir], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`unzip failed: ${result.stderr}`);
  const extracted = path.join(workDir, "cities1000.txt");
  if (!fs.existsSync(extracted)) throw new Error(`cities1000.txt not found in ${workDir}`);
  return extracted;
}

function resolveState(countryCode, admin1Code, admin1Map) {
  if (!admin1Code) return "";
  if (countryCode === "US") return admin1Code;
  const full = `${countryCode}.${admin1Code}`;
  return admin1Map.get(full) || "";
}

function buildRow(fields, admin1Map) {
  const [
    , // geonameid
    name,
    asciiname,
    , // alternatenames
    latitude,
    longitude,
    featureClass,
    , // featureCode
    countryCode,
    , // cc2
    admin1Code,
    , // admin2Code
    , // admin3Code
    , // admin4Code
    population
  ] = fields;

  if (featureClass !== "P") return null;
  const city = (asciiname || name || "").trim();
  if (!city) return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const cc = (countryCode || "").trim().toUpperCase();
  const state = resolveState(cc, (admin1Code || "").trim(), admin1Map);
  const pop = Number(population) || 0;

  return {
    key: cityKey(city, state || cc),
    city,
    state: state || "",
    country: cc,
    population: pop,
    lat,
    lng,
    source: "geonames"
  };
}

async function upsertBatch(rows) {
  if (!rows.length) return 0;
  const { error } = await getSupabaseAdmin()
    .from("city_geo")
    .upsert(rows, { onConflict: "key", ignoreDuplicates: false });
  if (error) throw error;
  return rows.length;
}

async function run() {
  const args = parseArgs(process.argv);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "citygeo-"));
  console.log(`Work dir: ${workDir}`);

  const admin1Map = await fetchAdmin1Map(workDir);
  const citiesFile = await resolveCitiesFile(args.file, workDir);

  console.log(`→ Parsing ${citiesFile} (min population ${args.minPop})`);
  const rl = readline.createInterface({
    input: fs.createReadStream(citiesFile, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  let batch = [];
  let total = 0;
  let written = 0;
  const seenKeys = new Set();

  for await (const line of rl) {
    if (!line) continue;
    const fields = line.split("\t");
    const row = buildRow(fields, admin1Map);
    if (!row) continue;
    if (row.population < args.minPop) continue;
    if (!row.key || seenKeys.has(row.key)) continue;
    seenKeys.add(row.key);

    batch.push(row);
    total += 1;
    if (batch.length >= BATCH_SIZE) {
      if (!args.dry) written += await upsertBatch(batch);
      batch = [];
      if (total % 5000 === 0) console.log(`  …${total} rows processed`);
    }
  }
  if (batch.length) {
    if (!args.dry) written += await upsertBatch(batch);
  }

  console.log(`✓ Parsed ${total} unique cities`);
  if (args.dry) console.log(`  (dry run — no rows written)`);
  else console.log(`✓ Upserted ${written} rows into city_geo`);
}

run().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
