// Repro: start "offline" (globalThis.fetch throws), then restore network and
// check that Yahoo quotes recover without restarting the process.
import { yahooFinance } from "../server/yahooClient";

const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new TypeError("fetch failed (simulated offline)");
}) as typeof fetch;

async function probe(label: string) {
  try {
    const q = await yahooFinance.quote("AAPL");
    console.log(`${label}: OK price=${q.regularMarketPrice}`);
    return true;
  } catch (e) {
    console.log(`${label}: FAIL ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

await probe("offline #1");
await probe("offline #2");
globalThis.fetch = realFetch;
console.log("-- network restored --");
const a = await probe("online #1");
const b = await probe("online #2");
process.exit(a || b ? 0 : 1);
