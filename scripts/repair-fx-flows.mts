/**
 * One-time repair: buy/sell flows for non-EUR holdings that were stored in the holding's own
 * currency (e.g. USD) as if they were EUR. Before the fix, editing a holding's shares directly
 * let the server log qty × price without converting.
 *
 * Detection: the holding's currency is not EUR and the stored amount is an exact cent value
 * (native qty × price). Properly converted amounts carry the FX rate's decimals.
 * Each match is converted at that day's Yahoo close and its note tagged, so reruns skip it.
 *
 * Usage:
 *   npx tsx scripts/repair-fx-flows.mts --db <path/to/portfolio.db>           (dry run)
 *   npx tsx scripts/repair-fx-flows.mts --db <path/to/portfolio.db> --apply   (backup + write)
 */
import Database from 'better-sqlite3';
import path from 'node:path';
import { yahooFinance } from '../server/yahooClient.ts';

const REPAIRED_TAG = 'converted from';

type FlowRow = { id: number; date: string; amount_eur: number; kind: string; asset_symbol: string | null; note: string | null };

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function isExactCents(amount: number): boolean {
  return Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6;
}

const closesCache = new Map<string, Record<string, number>>();

/** EUR per 1 unit of `cur` on `date` (last close on or before it). */
async function eurRateOn(cur: string, date: string): Promise<number> {
  let closes = closesCache.get(cur);
  if (!closes) {
    const chart: any = await yahooFinance.chart(
      `EUR${cur}=X`,
      { period1: '2020-01-01', period2: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), interval: '1d' },
      { validateResult: false }
    );
    closes = {};
    for (const q of chart.quotes ?? []) {
      if (q.close > 0) closes[new Date(q.date).toISOString().slice(0, 10)] = q.close;
    }
    closesCache.set(cur, closes);
  }
  const day = Object.keys(closes).sort().filter((d) => d <= date).pop();
  if (!day) throw new Error(`No EUR${cur} rate on or before ${date}`);
  return 1 / closes[day]!;
}

async function main() {
  const dbPath = argValue('--db');
  if (!dbPath) throw new Error('Pass --db <path to portfolio.db>');
  const apply = process.argv.includes('--apply');
  const db = new Database(dbPath, { readonly: !apply, fileMustExist: true });

  const currencyBySymbol = new Map<string, string>();
  for (const row of db.prepare('SELECT payload FROM assets').all() as { payload: string }[]) {
    const a = JSON.parse(row.payload) as { symbol?: string; currency?: string };
    if (a.symbol) currencyBySymbol.set(a.symbol, (a.currency || 'EUR').toUpperCase());
  }

  const flows = db
    .prepare("SELECT * FROM portfolio_flows WHERE asset_symbol IS NOT NULL AND kind IN ('buy','sell') ORDER BY date, id")
    .all() as FlowRow[];

  const fixes: { id: number; amountEur: number; note: string }[] = [];
  for (const f of flows) {
    const symbol = f.asset_symbol!;
    const cur = currencyBySymbol.get(symbol);
    const tag = `#${f.id} ${f.date} ${symbol.padEnd(15)} ${String(f.amount_eur.toFixed(2)).padStart(10)}`;
    if (!cur) {
      console.log(`${tag}  skip: holding no longer exists, currency unknown`);
      continue;
    }
    if (cur === 'EUR') continue;
    if ((f.note ?? '').includes(REPAIRED_TAG)) {
      console.log(`${tag}  skip: already repaired`);
      continue;
    }
    if (!isExactCents(f.amount_eur)) {
      console.log(`${tag}  ok: already EUR (${cur} holding, converted amount)`);
      continue;
    }
    const native = Math.round(f.amount_eur * 100) / 100;
    const rate = await eurRateOn(cur, f.date);
    const amountEur = native * rate;
    const note = `${f.note ?? (amountEur > 0 ? 'Purchase' : 'Sale')} (${REPAIRED_TAG} ${cur} ${native.toFixed(2)})`;
    console.log(`${tag}  FIX: ${cur} ${native.toFixed(2)} × ${rate.toFixed(4)} = EUR ${amountEur.toFixed(2)}`);
    fixes.push({ id: f.id, amountEur, note });
  }

  const before = fixes.reduce((s, f) => s + (flows.find((x) => x.id === f.id)!.amount_eur), 0);
  const after = fixes.reduce((s, f) => s + f.amountEur, 0);
  console.log(`\n${fixes.length} flow(s) to repair: ${before.toFixed(2)} → EUR ${after.toFixed(2)} (difference ${(after - before).toFixed(2)})`);

  if (!apply) {
    console.log('Dry run: nothing written. Re-run with --apply to back up and repair.');
    return;
  }
  if (fixes.length === 0) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(path.dirname(dbPath), `portfolio.backup-before-fx-repair-${stamp}.db`);
  await db.backup(backupPath);
  console.log(`Backup written: ${backupPath}`);

  const update = db.prepare('UPDATE portfolio_flows SET amount_eur = ?, note = ? WHERE id = ?');
  db.transaction(() => {
    for (const f of fixes) update.run(f.amountEur, f.note, f.id);
  })();
  console.log(`Repaired ${fixes.length} flow(s).`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
