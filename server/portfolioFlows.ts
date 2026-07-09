import type Database from "better-sqlite3";
import type { Asset, PortfolioFlow, PortfolioFlowKind } from "../src/types";
import { fxToEur } from "../src/formatCurrency";
import { todayIsoDateHelsinki } from "../src/formatDate";

export function ensurePortfolioFlowsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS portfolio_flows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      amount_eur REAL NOT NULL,
      kind TEXT NOT NULL,
      asset_symbol TEXT,
      note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_portfolio_flows_date ON portfolio_flows(date);
  `);
}

function rowToFlow(row: {
  id: number;
  date: string;
  amount_eur: number;
  kind: string;
  asset_symbol: string | null;
  note: string | null;
  created_at: string;
}): PortfolioFlow {
  return {
    id: String(row.id),
    date: row.date,
    amountEur: row.amount_eur,
    kind: row.kind as PortfolioFlowKind,
    ...(row.asset_symbol ? { assetSymbol: row.asset_symbol } : {}),
    ...(row.note ? { note: row.note } : {}),
    createdAt: row.created_at,
  };
}

export function listPortfolioFlows(db: Database.Database): PortfolioFlow[] {
  const rows = db
    .prepare(
      `SELECT id, date, amount_eur, kind, asset_symbol, note, created_at
       FROM portfolio_flows ORDER BY date ASC, id ASC`
    )
    .all() as {
    id: number;
    date: string;
    amount_eur: number;
    kind: string;
    asset_symbol: string | null;
    note: string | null;
    created_at: string;
  }[];
  return rows.map(rowToFlow);
}

export function insertPortfolioFlow(
  db: Database.Database,
  flow: {
    date?: string;
    amountEur: number;
    kind: PortfolioFlowKind;
    assetSymbol?: string;
    note?: string;
  }
): PortfolioFlow {
  const amount = flow.amountEur;
  if (!Number.isFinite(amount) || amount === 0) {
    throw new Error("Flow amount must be a non-zero finite number");
  }
  const date = flow.date?.trim() || todayIsoDateHelsinki();
  const createdAt = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO portfolio_flows (date, amount_eur, kind, asset_symbol, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      date,
      amount,
      flow.kind,
      flow.assetSymbol ?? null,
      flow.note ?? null,
      createdAt
    );
  return {
    id: String(result.lastInsertRowid),
    date,
    amountEur: amount,
    kind: flow.kind,
    ...(flow.assetSymbol ? { assetSymbol: flow.assetSymbol } : {}),
    ...(flow.note ? { note: flow.note } : {}),
    createdAt,
  };
}

/** Cost basis in EUR for a holding snapshot. */
export function assetCostBasisEur(
  asset: Pick<Asset, "quantity" | "averagePrice" | "currency">,
  exchangeRates: Record<string, number> = { EUR: 1 }
): number {
  const qty = Number(asset.quantity);
  const price = Number(asset.averagePrice);
  if (!Number.isFinite(qty) || !Number.isFinite(price) || qty <= 0 || price < 0) return 0;
  const cost = qty * price;
  const fx = fxToEur(asset.currency || "EUR", { EUR: 1, ...exchangeRates });
  return fx > 0 ? cost * fx : cost;
}

function parseOptionalFlowAmountEur(body: unknown): number | undefined {
  if (!body || typeof body !== "object") return undefined;
  const raw = (body as { flowAmountEur?: unknown }).flowAmountEur;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return raw;
}

export function recordAssetCreateFlow(
  db: Database.Database,
  asset: Asset,
  body: unknown,
  exchangeRates?: Record<string, number>
): void {
  const hinted = parseOptionalFlowAmountEur(body);
  const amount =
    hinted != null && hinted > 0
      ? hinted
      : assetCostBasisEur(asset, exchangeRates);
  if (!(amount > 0)) return;
  insertPortfolioFlow(db, {
    amountEur: amount,
    kind: "buy",
    assetSymbol: asset.symbol,
    note: "New holding",
  });
}

export function recordAssetUpdateFlows(
  db: Database.Database,
  prev: Asset,
  next: Asset,
  body: unknown,
  exchangeRates?: Record<string, number>
): void {
  const hinted = parseOptionalFlowAmountEur(body);
  const prevCost = assetCostBasisEur(prev, exchangeRates);
  const nextCost = assetCostBasisEur(next, exchangeRates);
  const delta = nextCost - prevCost;
  if (Math.abs(delta) < 0.01) return;

  if (hinted != null && Math.abs(hinted) >= 0.01) {
    insertPortfolioFlow(db, {
      amountEur: hinted,
      kind: hinted > 0 ? "buy" : "sell",
      assetSymbol: next.symbol,
      note: hinted > 0 ? "Purchase" : "Sale",
    });
    return;
  }

  insertPortfolioFlow(db, {
    amountEur: delta,
    kind: delta > 0 ? "buy" : "sell",
    assetSymbol: next.symbol,
    note: delta > 0 ? "Purchase" : "Sale",
  });
}

export function recordAssetDeleteFlow(
  db: Database.Database,
  asset: Asset,
  _exchangeRates?: Record<string, number>
): void {
  const today = todayIsoDateHelsinki();
  const symbol = asset.symbol?.trim();
  if (!symbol) return;

  // Same-day round-trip: remove the buy from create instead of recording a sell.
  const removed = db
    .prepare(
      `DELETE FROM portfolio_flows WHERE date = ? AND asset_symbol = ? AND kind = 'buy'`
    )
    .run(today, symbol);
  if (removed.changes > 0) return;

  // Holding removal is reflected in portfolio value; no external cash flow.
}

export function recordCashChangeFlow(
  db: Database.Database,
  previousEur: number,
  nextEur: number
): void {
  const delta = nextEur - previousEur;
  if (Math.abs(delta) < 0.01) return;
  insertPortfolioFlow(db, {
    amountEur: delta,
    kind: "cash",
    note: delta > 0 ? "Cash deposit" : "Cash withdrawal",
  });
}

export function importPortfolioFlows(
  db: Database.Database,
  flows: PortfolioFlow[],
  mode: "replace" | "merge"
): number {
  if (mode === "replace") {
    db.prepare("DELETE FROM portfolio_flows").run();
  }
  const insert = db.prepare(
    `INSERT INTO portfolio_flows (date, amount_eur, kind, asset_symbol, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  let count = 0;
  for (const flow of flows) {
    if (!flow.date || !Number.isFinite(flow.amountEur) || flow.amountEur === 0) continue;
    insert.run(
      flow.date,
      flow.amountEur,
      flow.kind,
      flow.assetSymbol ?? null,
      flow.note ?? null,
      flow.createdAt || new Date().toISOString()
    );
    count += 1;
  }
  return count;
}
