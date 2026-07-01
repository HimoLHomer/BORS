import type { Express, Request, Response } from "express";
import { registerDividendRoutes } from "./dividends";
import { backfillPortfolioHistory } from "./portfolioHistoryBackfill";
import { appRoot } from "./appRoot";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import type { Asset, HistoryPoint } from "../src/types";

let db: Database.Database | null = null;

function getDbPath(): string {
  const override = process.env.BORS_DB_PATH;
  if (override) return path.resolve(override);
  const dataDir = path.join(appRoot(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "portfolio.db");
}

export function getPortfolioDb(): Database.Database {
  if (db) return db;
  const file = getDbPath();
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      value REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS portfolio_cash (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      amount_eur REAL NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO portfolio_cash (id, amount_eur) VALUES (1, 0);
    CREATE TABLE IF NOT EXISTS ui_prefs (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL DEFAULT '{}'
    );
    INSERT OR IGNORE INTO ui_prefs (id, payload) VALUES (1, '{}');
  `);
  if (process.env.BORS_QUIET !== "1" && process.env.NODE_ENV !== "production") {
    console.log(`[portfolio] SQLite database: ${file}`);
  }
  return db;
}

function rowToAsset(row: { id: string; payload: string }): Asset {
  const a = JSON.parse(row.payload) as Asset;
  return { ...a, id: row.id };
}

function getCashAmountEur(): number {
  const row = getPortfolioDb()
    .prepare("SELECT amount_eur FROM portfolio_cash WHERE id = 1")
    .get() as { amount_eur: unknown } | undefined;
  const raw = row?.amount_eur;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? parseFloat(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function readUiPrefsPayload(): Record<string, unknown> {
  try {
    const row = getPortfolioDb()
      .prepare("SELECT payload FROM ui_prefs WHERE id = 1")
      .get() as { payload: string } | undefined;
    if (!row?.payload) return {};
    const o = JSON.parse(row.payload) as unknown;
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeUiPrefsPayload(next: Record<string, unknown>): void {
  getPortfolioDb()
    .prepare("UPDATE ui_prefs SET payload = ? WHERE id = 1")
    .run(JSON.stringify(next));
}

/** Dividend/FIRE/logo settings mirrored from browser localStorage. */
export function readClientSettingsPayload(): Record<string, unknown> {
  const prefs = readUiPrefsPayload();
  const raw = prefs.clientSettings;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

export function writeClientSettingsPayload(next: Record<string, unknown>): void {
  const prefs = readUiPrefsPayload();
  prefs.clientSettings = next;
  writeUiPrefsPayload(prefs);
}

export function registerPortfolioRoutes(app: Express, yahooFinance?: any): void {
  getPortfolioDb();

  app.get("/api/portfolio/status", (_req: Request, res: Response) => {
    const payload: { storage: string; dbPath?: string } = { storage: "sqlite" };
    payload.dbPath = getDbPath();
    res.json(payload);
  });

  app.get("/api/portfolio/client-settings", (_req: Request, res: Response) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(readClientSettingsPayload());
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to read client settings" });
    }
  });

  app.put("/api/portfolio/client-settings", (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return res.status(400).json({ error: "Body must be a JSON object" });
      }
      writeClientSettingsPayload(body);
      res.set("Cache-Control", "no-store");
      res.json(readClientSettingsPayload());
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to save client settings" });
    }
  });

  app.get("/api/portfolio/cash", (_req: Request, res: Response) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json({ amountEur: getCashAmountEur() });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to read cash" });
    }
  });

  app.put("/api/portfolio/cash", (req: Request, res: Response) => {
    try {
      const raw = (req.body as { amountEur?: unknown }).amountEur;
      const amount = typeof raw === "number" ? raw : parseFloat(String(raw));
      if (!Number.isFinite(amount) || amount < 0) {
        return res.status(400).json({ error: "amountEur must be a non-negative number" });
      }
      getPortfolioDb()
        .prepare("UPDATE portfolio_cash SET amount_eur = ? WHERE id = 1")
        .run(amount);
      res.set("Cache-Control", "no-store");
      res.json({ amountEur: getCashAmountEur() });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to save cash" });
    }
  });

  app.get("/api/portfolio/ui-prefs", (_req: Request, res: Response) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(readUiPrefsPayload());
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to read UI preferences" });
    }
  });

  app.put("/api/portfolio/ui-prefs", (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      const prev = readUiPrefsPayload();
      if (body.allocationLabelOffsets !== undefined) prev.allocationLabelOffsets = body.allocationLabelOffsets;
      if (body.allocationChrome !== undefined) prev.allocationChrome = body.allocationChrome;
      writeUiPrefsPayload(prev);
      res.set("Cache-Control", "no-store");
      res.json(readUiPrefsPayload());
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to save UI preferences" });
    }
  });

  app.get("/api/portfolio/assets", (_req: Request, res: Response) => {
    try {
      const rows = getPortfolioDb()
        .prepare("SELECT id, payload FROM assets ORDER BY json_extract(payload, '$.symbol')")
        .all() as { id: string; payload: string }[];
      res.set("Cache-Control", "no-store");
      res.json(rows.map(rowToAsset));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to read assets" });
    }
  });

  app.post("/api/portfolio/assets", (req: Request, res: Response) => {
    try {
      const body = req.body as Asset;
      const id = body.id || crypto.randomUUID();
      const { id: _omit, ...rest } = body;
      const asset: Asset = { ...rest, id, updatedAt: rest.updatedAt || new Date().toISOString() };
      const payload = JSON.stringify(asset);
      getPortfolioDb().prepare("INSERT INTO assets (id, payload) VALUES (?, ?)").run(id, payload);
      res.status(201).json(asset);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create asset" });
    }
  });

  app.patch("/api/portfolio/assets/:id", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const row = getPortfolioDb()
        .prepare("SELECT id, payload FROM assets WHERE id = ?")
        .get(id) as { id: string; payload: string } | undefined;
      if (!row) return res.status(404).json({ error: "Asset not found" });
      const prev = JSON.parse(row.payload) as Asset;
      const patch = req.body as Partial<Asset>;
      const next: Asset = {
        ...prev,
        ...patch,
        id,
        updatedAt: new Date().toISOString(),
      };
      getPortfolioDb()
        .prepare("UPDATE assets SET payload = ? WHERE id = ?")
        .run(JSON.stringify(next), id);
      res.json(next);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update asset" });
    }
  });

  app.delete("/api/portfolio/assets/:id", (req: Request, res: Response) => {
    try {
      const r = getPortfolioDb().prepare("DELETE FROM assets WHERE id = ?").run(req.params.id);
      if (r.changes === 0) return res.status(404).json({ error: "Asset not found" });
      res.status(204).send();
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to delete asset" });
    }
  });

  app.get("/api/portfolio/history", (_req: Request, res: Response) => {
    try {
      const rows = getPortfolioDb()
        .prepare("SELECT id, date, value FROM history ORDER BY date ASC")
        .all() as { id: number; date: string; value: number }[];
      const points: HistoryPoint[] = rows.map((r) => ({
        id: String(r.id),
        date: r.date,
        value: r.value,
      }));
      res.set("Cache-Control", "no-store");
      res.json(points);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to read history" });
    }
  });

  /** Upsert one history point by date (one value per day). */
  app.post("/api/portfolio/history", (req: Request, res: Response) => {
    try {
      const { date, value } = req.body as { date: string; value: number };
      if (!date || typeof value !== "number") {
        return res.status(400).json({ error: "date and value required" });
      }
      getPortfolioDb()
        .prepare(
          `INSERT INTO history (date, value) VALUES (?, ?)
           ON CONFLICT(date) DO UPDATE SET value = excluded.value`
        )
        .run(date, value);
      const row = getPortfolioDb()
        .prepare("SELECT id, date, value FROM history WHERE date = ?")
        .get(date) as { id: number; date: string; value: number };
      res.json({ id: String(row.id), date: row.date, value: row.value } as HistoryPoint);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to write history" });
    }
  });

  app.delete("/api/portfolio/history/:date", (req: Request, res: Response) => {
    try {
      const date = decodeURIComponent(req.params.date);
      const r = getPortfolioDb().prepare("DELETE FROM history WHERE date = ?").run(date);
      if (r.changes === 0) return res.status(404).json({ error: "Not found" });
      res.status(204).send();
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to delete history" });
    }
  });

  /** Fill missing history dates up to yesterday using Yahoo historical closes (gap-only). */
  app.post("/api/portfolio/history/backfill", (req: Request, res: Response) => {
    void (async () => {
      try {
        if (!yahooFinance) {
          res.status(503).json({ error: "Market data unavailable" });
          return;
        }
        const maxDaysRaw = req.query.maxDays;
        const maxDays =
          typeof maxDaysRaw === "string" && /^\d+$/.test(maxDaysRaw)
            ? Math.min(365, Math.max(1, parseInt(maxDaysRaw, 10)))
            : undefined;
        const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true";
        const result = await backfillPortfolioHistory(yahooFinance, { maxDays, dryRun });
        res.set("Cache-Control", "no-store");
        res.json(result);
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to backfill history" });
      }
    })();
  });

  app.get("/api/portfolio/export", (_req: Request, res: Response) => {
    try {
      const assets = (getPortfolioDb().prepare("SELECT id, payload FROM assets").all() as { id: string; payload: string }[]).map(
        rowToAsset
      );
      const history = (getPortfolioDb()
        .prepare("SELECT id, date, value FROM history ORDER BY date ASC")
        .all() as { id: number; date: string; value: number }[]).map((r) => ({
        id: String(r.id),
        date: r.date,
        value: r.value,
      }));
      const uiPrefs = readUiPrefsPayload();
      const clientSettings = readClientSettingsPayload();
      res.json({
        version: 2,
        exportedAt: new Date().toISOString(),
        assets,
        history,
        cashEur: getCashAmountEur(),
        uiPrefs,
        clientSettings,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to export" });
    }
  });

  app.post("/api/portfolio/import", (req: Request, res: Response) => {
    try {
      const mode = (req.query.mode as string) === "replace" ? "replace" : "merge";
      const body = req.body as {
        assets?: Asset[];
        history?: HistoryPoint[];
        cashEur?: unknown;
        uiPrefs?: unknown;
        clientSettings?: unknown;
      };
      const d = getPortfolioDb();
      const importAssets = Array.isArray(body.assets) ? body.assets : [];
      const importHistory = Array.isArray(body.history) ? body.history : [];

      if (mode === "replace") {
        d.prepare("DELETE FROM history").run();
        d.prepare("DELETE FROM assets").run();
        d.prepare("UPDATE portfolio_cash SET amount_eur = 0 WHERE id = 1").run();
      }

      const insertAsset = d.prepare("INSERT INTO assets (id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload");

      for (const a of importAssets) {
        const id = a.id || crypto.randomUUID();
        const asset: Asset = { ...a, id, updatedAt: a.updatedAt || new Date().toISOString() };
        insertAsset.run(id, JSON.stringify(asset));
      }

      const upsertHistory = d.prepare(
        `INSERT INTO history (date, value) VALUES (?, ?)
         ON CONFLICT(date) DO UPDATE SET value = excluded.value`
      );
      for (const h of importHistory) {
        if (h.date && typeof h.value === "number") upsertHistory.run(h.date, h.value);
      }

      if (body.cashEur !== undefined && body.cashEur !== null) {
        const c = typeof body.cashEur === "number" ? body.cashEur : parseFloat(String(body.cashEur));
        if (Number.isFinite(c) && c >= 0) {
          d.prepare("UPDATE portfolio_cash SET amount_eur = ? WHERE id = 1").run(c);
        }
      }

      if (body.uiPrefs && typeof body.uiPrefs === "object" && !Array.isArray(body.uiPrefs)) {
        const incoming = body.uiPrefs as Record<string, unknown>;
        if (body.clientSettings && typeof body.clientSettings === "object" && !Array.isArray(body.clientSettings)) {
          incoming.clientSettings = body.clientSettings as Record<string, unknown>;
        }
        writeUiPrefsPayload(incoming);
      } else if (
        body.clientSettings &&
        typeof body.clientSettings === "object" &&
        !Array.isArray(body.clientSettings)
      ) {
        writeClientSettingsPayload(body.clientSettings as Record<string, unknown>);
      }

      res.json({ ok: true, mode, assetsImported: importAssets.length, historyImported: importHistory.length });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to import" });
    }
  });

  if (yahooFinance) {
    registerDividendRoutes(app, yahooFinance);
  }
}
