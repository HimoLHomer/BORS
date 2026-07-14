/**
 * Validates bundled heatmap constituent JSON.
 * Run: npm run test:constituents
 */
import fs from "fs";
import path from "path";

type MarketConstituent = { symbol: string; name: string; sector: string };

const root = process.cwd();
const sp500Path = path.join(root, "assets/market/sp500.json");
const omxh25Path = path.join(root, "assets/market/omxh25.json");

function load(file: string): MarketConstituent[] {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`${file} is not an array`);
  return parsed as MarketConstituent[];
}

function assertFields(rows: MarketConstituent[], file: string): void {
  for (const row of rows) {
    if (!row.symbol?.trim()) throw new Error(`${file}: empty symbol`);
    if (!row.name?.trim()) throw new Error(`${file}: empty name for ${row.symbol}`);
    if (!row.sector?.trim()) throw new Error(`${file}: empty sector for ${row.symbol}`);
    if (/\s/.test(row.symbol)) throw new Error(`${file}: symbol contains spaces: ${row.symbol}`);
  }
}

function assertUnique(rows: MarketConstituent[], file: string): void {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.symbol)) throw new Error(`${file}: duplicate symbol ${row.symbol}`);
    seen.add(row.symbol);
  }
}

function validateSp500(rows: MarketConstituent[]): void {
  if (rows.length < 490 || rows.length > 510) {
    throw new Error(`sp500.json count ${rows.length} outside 490–510`);
  }
}

function validateOmxh25(rows: MarketConstituent[]): void {
  if (rows.length !== 25) {
    throw new Error(`omxh25.json count ${rows.length} (expected 25)`);
  }
  for (const row of rows) {
    if (!row.symbol.endsWith(".HE")) {
      throw new Error(`omxh25.json: ${row.symbol} missing .HE suffix`);
    }
  }

  const month = new Date().getUTCMonth() + 1;
  const inReconstitutionWindow = month === 2 || month === 8;
  if (!inReconstitutionWindow && process.env.WARN_OMX_OUTSIDE_RECON === "1") {
    console.warn("Note: OMX reconstitution typically occurs in Feb/Aug.");
  }
}

function main(): void {
  const sp500 = load(sp500Path);
  const omxh25 = load(omxh25Path);

  assertFields(sp500, "sp500.json");
  assertFields(omxh25, "omxh25.json");
  assertUnique(sp500, "sp500.json");
  assertUnique(omxh25, "omxh25.json");
  validateSp500(sp500);
  validateOmxh25(omxh25);

  console.log(`OK — sp500.json (${sp500.length}), omxh25.json (${omxh25.length})`);
}

main();
