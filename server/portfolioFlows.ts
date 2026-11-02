import type Database from "better-sqlite3";
import type { Asset, PortfolioFlow, PortfolioFlowKind } from "../src/types";
import { fxToEur } from "../src/formatCurrency";
import { todayIsoDateHelsinki } from "../src/formatDate";
import { NEW_HOLDING_NOTE, TRANSFER_IN_NOTE } from "../src/flowNotes";

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

/**
 * Cost basis in EUR for a holding snapshot. NaN when the holding's currency has no rate,
 * so a native amount is never stored as if it were EUR.
 */
export function assetCostBasisEur(
  asset: Pick<Asset, "quantity" | "averagePrice" | "currency">,
  exchangeRates: Record<string, number> = { EUR: 1 }
): number {
  const qty = Number(asset.quantity);
  const price = Number(asset.averagePrice);
  if (!Number.isFinite(qty) || !Number.isFinite(price) || qty <= 0 || price < 0) return 0;
  const cost = qty * price;
  const fx = fxToEur(asset.currency || "EUR", { EUR: 1, ...exchangeRates });
  return fx > 0 ? cost * fx : NaN;
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
  exchangeRates?: Record<string, number>,
  /** Set when the holding was already owned: logged at this market value, not as a purchase. */
  transferInValueEur?: number | null
): void {
  if (transferInValueEur != null) {
    const value = transferInValueEur > 0 ? transferInValueEur : assetCostBasisEur(asset, exchangeRates);
    if (Number.isFinite(value) && value >= 0.01) {
      insertPortfolioFlow(db, { amountEur: value, kind: "buy", assetSymbol: asset.symbol, note: TRANSFER_IN_NOTE });
    }
    return;
  }
  const hinted = parseOptionalFlowAmountEur(body);
  const amount =
    hinted != null && hinted > 0
      ? hinted
      : assetCostBasisEur(asset, exchangeRates);
  if (Number.isNaN(amount)) {
    console.warn(`No EUR rate for ${asset.currency}; skipped flow for new ${asset.symbol}`);
    return;
  }
  if (!(amount > 0)) return;
  insertPortfolioFlow(db, {
    amountEur: amount,
    kind: "buy",
    assetSymbol: asset.symbol,
    note: NEW_HOLDING_NOTE,
  });
}

export function recordAssetUpdateFlows(
  db: Database.Database,
  prev: Asset,
  next: Asset,
  body: unknown,
  exchangeRates?: Record<string, number>,
  /** Market value in EUR of the shares removed, when the share count went down. */
  soldValueEur?: number | null
): void {
  // Fewer shares = a sale: log the shares removed at market value, not at cost.
  if (Number(next.quantity) < Number(prev.quantity) && soldValueEur != null && soldValueEur >= 0.01) {
    insertPortfolioFlow(db, { amountEur: -soldValueEur, kind: "sell", assetSymbol: next.symbol, note: "Sale" });
    return;
  }

  const hinted = parseOptionalFlowAmountEur(body);
  const prevCost = assetCostBasisEur(prev, exchangeRates);
  const nextCost = assetCostBasisEur(next, exchangeRates);
  const delta = nextCost - prevCost;
  if (Number.isFinite(delta) && Math.abs(delta) < 0.01) return;

  if (hinted != null && Math.abs(hinted) >= 0.01) {
    insertPortfolioFlow(db, {
      amountEur: hinted,
      kind: hinted > 0 ? "buy" : "sell",
      assetSymbol: next.symbol,
      note: hinted > 0 ? "Purchase" : "Sale",
    });
    return;
  }

  if (!Number.isFinite(delta)) {
    console.warn(`No EUR rate for ${next.currency}; skipped flow for ${next.symbol} edit`);
    return;
  }
  insertPortfolioFlow(db, {
    amountEur: delta,
    kind: delta > 0 ? "buy" : "sell",
    assetSymbol: next.symbol,
    note: delta > 0 ? "Purchase" : "Sale",
  });
}

/** Share of a deleted holding's value bought today above which deletion is treated as an undo. */
const SAME_DAY_UNDO_SHARE = 0.95;

/**
 * Deleting a holding is a sale: its value leaves the holdings, so log it as an outflow at
 * market value (else range returns count the whole value as a loss). Exception: a holding
 * (almost) entirely bought today is treated as an undo, and today's buy entries are removed.
 */
export function recordAssetDeleteFlow(
  db: Database.Database,
  asset: Asset,
  saleValueEur: number | null,
  exchangeRates?: Record<string, number>
): void {
  const today = todayIsoDateHelsinki();
  const symbol = asset.symbol?.trim();
  if (!symbol) return;

  const value = saleValueEur != null && saleValueEur > 0 ? saleValueEur : assetCostBasisEur(asset, exchangeRates);
  const boughtToday =
    (db
      .prepare(
        `SELECT COALESCE(SUM(amount_eur), 0) AS s FROM portfolio_flows WHERE date = ? AND asset_symbol = ? AND kind = 'buy'`
      )
      .get(today, symbol) as { s: number }).s ?? 0;

  if (boughtToday > 0 && (!Number.isFinite(value) || boughtToday >= value * SAME_DAY_UNDO_SHARE)) {
    db.prepare(`DELETE FROM portfolio_flows WHERE date = ? AND asset_symbol = ? AND kind = 'buy'`).run(today, symbol);
    return;
  }
  if (!Number.isFinite(value) || value < 0.01) {
    console.warn(`No value for deleted ${symbol}; sale not logged`);
    return;
  }
  insertPortfolioFlow(db, { amountEur: -value, kind: "sell", assetSymbol: symbol, note: "Sold (holding removed)" });
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
  // Merging the same backup again must not duplicate entries (each would count as new money).
  const exists = db.prepare(
    `SELECT 1 FROM portfolio_flows
     WHERE date = ? AND amount_eur = ? AND kind = ? AND COALESCE(asset_symbol, '') = ? AND created_at = ?
     LIMIT 1`
  );
  let count = 0;
  for (const flow of flows) {
    if (!flow.date || !Number.isFinite(flow.amountEur) || flow.amountEur === 0) continue;
    if (
      mode === "merge" &&
      flow.createdAt &&
      exists.get(flow.date, flow.amountEur, flow.kind, flow.assetSymbol ?? "", flow.createdAt)
    ) {
      continue;
    }
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
