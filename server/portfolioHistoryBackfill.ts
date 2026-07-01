import type { HistoryPoint } from "../src/types";
import {
  DEFAULT_HISTORY_BACKFILL_MAX_DAYS,
  listMissingHistoryDates,
  yesterdayIsoDateHelsinki,
} from "../src/portfolioHistoryDates";
import { getPortfolioDb } from "./portfolio";
import { computePortfolioTotalsForDates } from "./portfolioValuation";

type YahooFinanceLike = Parameters<typeof computePortfolioTotalsForDates>[0];

export { listMissingHistoryDates, DEFAULT_HISTORY_BACKFILL_MAX_DAYS };

function readExistingHistoryDates(): string[] {
  const rows = getPortfolioDb()
    .prepare("SELECT date FROM history ORDER BY date ASC")
    .all() as { date: string }[];
  return rows.map((r) => r.date);
}

export type BackfillResult = {
  filled: HistoryPoint[];
  skipped: string[];
};

export async function backfillPortfolioHistory(
  yahooFinance: YahooFinanceLike,
  opts?: { maxDays?: number; dryRun?: boolean }
): Promise<BackfillResult> {
  const maxDays = opts?.maxDays ?? DEFAULT_HISTORY_BACKFILL_MAX_DAYS;
  const dryRun = opts?.dryRun === true;
  const untilYesterday = yesterdayIsoDateHelsinki();
  const existing = readExistingHistoryDates();
  const missing = listMissingHistoryDates(existing, untilYesterday, maxDays);

  if (missing.length === 0) {
    return { filled: [], skipped: [] };
  }

  const totals = await computePortfolioTotalsForDates(yahooFinance, missing);
  const filled: HistoryPoint[] = [];
  const skipped: string[] = [];

  const insertGapOnly = getPortfolioDb().prepare(
    `INSERT INTO history (date, value) VALUES (?, ?)
     ON CONFLICT(date) DO NOTHING`
  );
  const selectRow = getPortfolioDb().prepare(
    "SELECT id, date, value FROM history WHERE date = ?"
  );

  for (const date of missing) {
    const value = totals.get(date);
    if (value == null || !(value > 0)) {
      skipped.push(date);
      continue;
    }
    if (dryRun) {
      filled.push({ date, value });
      continue;
    }
    const result = insertGapOnly.run(date, value);
    if (result.changes === 0) {
      skipped.push(date);
      continue;
    }
    const row = selectRow.get(date) as { id: number; date: string; value: number } | undefined;
    if (row) {
      filled.push({ id: String(row.id), date: row.date, value: row.value });
    }
  }

  return { filled, skipped };
}
