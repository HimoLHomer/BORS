/**
 * Sync heatmap constituent JSON from Wikipedia (S&P 500 + OMX Helsinki 25).
 * Updates bundled assets for CI/dev. Runtime app sync uses server/marketConstituentStore.
 * Run: npm run sync:constituents
 */
import fs from "fs";
import path from "path";
import {
  fetchOmxh25Constituents,
  fetchSp500Constituents,
  type MarketConstituent,
} from "../server/wikipediaConstituents.ts";

const root = process.cwd();
const sp500Path = path.join(root, "assets/market/sp500.json");
const omxh25Path = path.join(root, "assets/market/omxh25.json");

function loadExisting(file: string): MarketConstituent[] {
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf8")) as MarketConstituent[];
}

function printDiff(label: string, prev: MarketConstituent[], next: MarketConstituent[]): void {
  const prevSyms = new Set(prev.map((c) => c.symbol));
  const nextSyms = new Set(next.map((c) => c.symbol));
  const added = next.filter((c) => !prevSyms.has(c.symbol)).map((c) => c.symbol);
  const removed = prev.filter((c) => !nextSyms.has(c.symbol)).map((c) => c.symbol);

  console.log(`\n${label}: ${prev.length} → ${next.length}`);
  if (added.length === 0 && removed.length === 0) {
    console.log("  No membership changes.");
    return;
  }
  if (added.length) console.log(`  Added (${added.length}): ${added.join(", ")}`);
  if (removed.length) console.log(`  Removed (${removed.length}): ${removed.join(", ")}`);
  if (added.length + removed.length > 10) {
    console.warn(`${label}: large membership change (${added.length + removed.length} symbols).`);
  }
}

function writeJson(file: string, data: MarketConstituent[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data)}\n`, "utf8");
}

async function main(): Promise<void> {
  if (process.env.SYNC_CONSTITUENTS_SKIP === "1") {
    console.log("SYNC_CONSTITUENTS_SKIP=1 — skipping constituent sync.");
    return;
  }

  const prevSp = loadExisting(sp500Path);
  const prevOmx = loadExisting(omxh25Path);

  console.log("Fetching S&P 500 from Wikipedia…");
  const sp500 = await fetchSp500Constituents();
  console.log(`  OK — ${sp500.length} symbols`);

  console.log("Fetching OMX Helsinki 25 from Wikipedia…");
  const omxh25 = await fetchOmxh25Constituents();
  console.log(`  OK — ${omxh25.length} symbols`);

  printDiff("S&P 500", prevSp, sp500);
  printDiff("OMX Helsinki 25", prevOmx, omxh25);

  writeJson(sp500Path, sp500);
  writeJson(omxh25Path, omxh25);

  console.log("\nWrote:");
  console.log(`  ${sp500Path}`);
  console.log(`  ${omxh25Path}`);
}

main().catch((e) => {
  console.error("Constituent sync failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
