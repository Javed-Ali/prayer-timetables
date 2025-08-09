import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { DateTime } from "luxon";

// Usage: node scripts/build-month.mjs <region> <year> <month> <timezone>
const [,, region, yearStr, monthStr, tz] = process.argv;
if (!region || !yearStr || !monthStr || !tz) {
  console.error("Usage: node scripts/build-month.mjs <region> <year> <month> <IANA-timezone>");
  process.exit(1);
}

const year = Number(yearStr);
const month = Number(monthStr);
const csvPath = `data/${region}/${year}/${monthStr}.csv`;
const outDir  = `${region}/${year}`;        // NOTE: writes into REPO ROOT so Pages can serve it
await fs.mkdir(outDir, { recursive: true });

const csvRaw = await fs.readFile(csvPath, "utf8");
const rows = parse(csvRaw, { columns: true, skip_empty_lines: true });

// convert "HH:MM" (local in tz) to ISO with offset included
const toISO = (day, hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  const dt = DateTime.fromObject({ year, month, day, hour: h, minute: m }, { zone: tz });
  if (!dt.isValid) throw new Error(`Invalid time '${hhmm}' on ${year}-${month}-${day}: ${dt.invalidExplanation}`);
  return dt.toISO({ suppressMilliseconds: true });
};

const days = rows.map(r => {
  const day = Number(r.date);
  return {
    date: DateTime.fromObject({ year, month, day }, { zone: "UTC" }).toISODate(),
    times: {
      fajr: toISO(day, r.fajr),
      sunrise: toISO(day, r.sunrise),
      dhuhr: toISO(day, r.dhuhr),
      asr: {
        shafi: toISO(day, r.asr_shafi),
        hanafi: toISO(day, r.asr_hanafi)
      },
      maghrib: toISO(day, r.maghrib),
      isha: toISO(day, r.isha)
    }
  };
});

// edit this list if you need to change offsets
const regional_offsets = [
  { areas: ["Rakiraki","Dobuilevu","Navua"], offset_minutes: 1 },
  { areas: ["Tavua"], offset_minutes: 2 },
  { areas: ["Ba","Varavu","Rarawai"], offset_minutes: 3 },
  { areas: ["Lautoka","Sabeto","Nadi","Maro","Sigatoka"], offset_minutes: 4 },
  { areas: ["Levuka"], offset_minutes: -1 },
  { areas: ["Savusavu","Labasa"], offset_minutes: -4 },
  { areas: ["Taveuni","Rabi","Moala"], offset_minutes: -6 },
  { areas: ["Lakeba"], offset_minutes: -11 }
];

const payload = {
  schema_version: 1,
  region,
  month: `${yearStr}-${monthStr}`,
  timezone: tz,
  version: 1, // bump if you republish mid-month
  generated_at: new Date().toISOString(),
  sha256: "",
  days,
  regional_offsets
};

const pretty = JSON.stringify(payload, null, 2);
const sha = createHash("sha256").update(pretty).digest("hex");
payload.sha256 = sha;

// write compact JSON for delivery
const final = JSON.stringify(payload);
await fs.writeFile(`${outDir}/${monthStr}.json`, final);
// also update region "latest.json" for convenience
await fs.writeFile(`${region}/latest.json`, final);

console.log(`Built ${outDir}/${monthStr}.json`);
console.log(`SHA-256: ${sha}`);
