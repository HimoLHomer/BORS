import Database from "better-sqlite3";
import {
  DEFAULT_HISTORY_BACKFILL_MAX_DAYS,
  listMissingHistoryDates,
} from "../src/portfolioHistoryDates.ts";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// --- listMissingHistoryDates ---

const noExisting = listMissingHistoryDates([], "2026-05-10", 5);
assert(
  noExisting.join(",") === "2026-05-06,2026-05-07,2026-05-08,2026-05-09,2026-05-10",
  "empty existing fills capped window ending at untilDate"
);

const withGap = listMissingHistoryDates(
  ["2026-05-01", "2026-05-03"],
  "2026-05-06",
  90
);
assert(
  withGap.join(",") === "2026-05-04,2026-05-05,2026-05-06",
  "fills from day after latest stored through untilDate, skipping existing"
);

const capped = listMissingHistoryDates([], "2026-05-20", 3);
assert(
  capped.join(",") === "2026-05-18,2026-05-19,2026-05-20",
  "respects maxDays cap"
);

const upToDate = listMissingHistoryDates(["2026-05-10"], "2026-05-10", 90);
assert(upToDate.length === 0, "no gaps when latest equals untilDate");

const beyondUntil = listMissingHistoryDates(["2026-05-12"], "2026-05-10", 90);
assert(beyondUntil.length === 0, "no gaps when latest is after untilDate");

assert(
  DEFAULT_HISTORY_BACKFILL_MAX_DAYS === 90,
  "default backfill window is 90 days"
);

const longGap = listMissingHistoryDates(["2026-01-01"], "2026-05-20", 7);
assert(longGap.length === 7, "long gap is capped to maxDays from untilDate");

// --- gap-only upsert (ON CONFLICT DO NOTHING) ---

const db = new Database(":memory:");
db.exec(
  `CREATE TABLE history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    value REAL NOT NULL
  )`
);
const insertGapOnly = db.prepare(
  `INSERT INTO history (date, value) VALUES (?, ?)
   ON CONFLICT(date) DO NOTHING`
);

const first = insertGapOnly.run("2026-05-10", 1000);
assert(first.changes === 1, "first insert succeeds");

const conflict = insertGapOnly.run("2026-05-10", 2000);
assert(conflict.changes === 0, "conflict insert is skipped (gap-only)");

const row = db
  .prepare("SELECT value FROM history WHERE date = ?")
  .get("2026-05-10") as { value: number };
assert(Math.abs(row.value - 1000) < 0.01, "existing row is not overwritten");

const second = insertGapOnly.run("2026-05-11", 1100);
assert(second.changes === 1, "new gap date inserts");

console.log("test-portfolio-history-backfill: ok");
