/**
 * Shared fixtures and assertions for portfolio API / production build verification.
 */
import fs from "fs";
import os from "os";
import path from "path";

export const FIXTURE_SYMBOLS = ["VERIFY.TEST.A", "VERIFY.TEST.B"] as const;

export type SeedAsset = {
  symbol: string;
  displaySymbol: string;
  name: string;
  type: "stock";
  quantity: number;
  averagePrice: number;
  currency: string;
  updatedAt: string;
};

export function createTempDbPath(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${process.pid}-${Date.now()}.db`);
}

export function removeDbFiles(dbPath: string): void {
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}

export function fixtureAssets(): SeedAsset[] {
  const updatedAt = new Date().toISOString();
  return [
    {
      symbol: FIXTURE_SYMBOLS[0],
      displaySymbol: "VTA",
      name: "Verify Test A",
      type: "stock",
      quantity: 10,
      averagePrice: 100,
      currency: "EUR",
      updatedAt,
    },
    {
      symbol: FIXTURE_SYMBOLS[1],
      displaySymbol: "VTB",
      name: "Verify Test B",
      type: "stock",
      quantity: 5,
      averagePrice: 50,
      currency: "EUR",
      updatedAt,
    },
  ];
}

export async function seedPortfolioViaHttp(base: string): Promise<void> {
  for (const asset of fixtureAssets()) {
    const res = await fetch(`${base}/api/portfolio/assets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(asset),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`POST asset ${asset.symbol} failed: HTTP ${res.status} ${body.slice(0, 200)}`);
    }
  }

  const histRes = await fetch(`${base}/api/portfolio/history`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date: "2026-01-01", value: 1234.56 }),
  });
  if (!histRes.ok) {
    const body = await histRes.text();
    throw new Error(`POST history failed: HTTP ${histRes.status} ${body.slice(0, 200)}`);
  }
}

type AssetRow = { symbol: string };
type ExportPayload = {
  version?: number;
  assets?: AssetRow[];
  history?: { date: string; value: number }[];
  clientSettings?: Record<string, unknown>;
};

export async function assertPortfolioApi(base: string): Promise<void> {
  const assetsRes = await fetch(`${base}/api/portfolio/assets`);
  const assetsCt = assetsRes.headers.get("content-type") || "";
  if (!assetsRes.ok) {
    throw new Error(`GET /api/portfolio/assets failed: HTTP ${assetsRes.status}`);
  }
  if (!assetsCt.includes("application/json")) {
    throw new Error(`GET /api/portfolio/assets expected JSON, got ${assetsCt}`);
  }
  const cache = assetsRes.headers.get("cache-control") || "";
  if (!cache.includes("no-store")) {
    throw new Error(`GET /api/portfolio/assets expected Cache-Control: no-store, got "${cache}"`);
  }

  const assets = (await assetsRes.json()) as AssetRow[];
  if (assets.length !== FIXTURE_SYMBOLS.length) {
    throw new Error(`Expected ${FIXTURE_SYMBOLS.length} assets, got ${assets.length}`);
  }
  const symbols = assets.map((a) => a.symbol).sort();
  const expected = [...FIXTURE_SYMBOLS].sort();
  if (symbols.join(",") !== expected.join(",")) {
    throw new Error(`Asset symbols mismatch: got [${symbols.join(", ")}], expected [${expected.join(", ")}]`);
  }

  const exportRes = await fetch(`${base}/api/portfolio/export`);
  if (!exportRes.ok) {
    throw new Error(`GET /api/portfolio/export failed: HTTP ${exportRes.status}`);
  }
  const exported = (await exportRes.json()) as ExportPayload;
  if (exported.version !== 1 && exported.version !== 2 && exported.version !== 3) {
    throw new Error(`Export version expected 1, 2, or 3, got ${exported.version}`);
  }
  if ((exported.version === 2 || exported.version === 3) && exported.clientSettings != null && typeof exported.clientSettings !== "object") {
    throw new Error("Export clientSettings must be an object when present");
  }
  if (!exported.assets || exported.assets.length !== FIXTURE_SYMBOLS.length) {
    throw new Error(`Export assets count expected ${FIXTURE_SYMBOLS.length}`);
  }
  if (!exported.history || exported.history.length < 1) {
    throw new Error("Export history expected at least 1 point");
  }

  const statusRes = await fetch(`${base}/api/portfolio/status`);
  if (!statusRes.ok) {
    throw new Error(`GET /api/portfolio/status failed: HTTP ${statusRes.status}`);
  }
  const status = (await statusRes.json()) as { storage?: string };
  if (status.storage !== "sqlite") {
    throw new Error(`status.storage expected sqlite, got ${status.storage}`);
  }

  const backfillRes = await fetch(`${base}/api/portfolio/history/backfill?dryRun=true`, {
    method: "POST",
  });
  if (backfillRes.status === 503) {
    throw new Error("POST /api/portfolio/history/backfill returned 503 without yahooFinance mock");
  }
  if (!backfillRes.ok) {
    throw new Error(`POST /api/portfolio/history/backfill failed: HTTP ${backfillRes.status}`);
  }
  const backfill = (await backfillRes.json()) as { filled?: unknown[]; skipped?: unknown[] };
  if (!Array.isArray(backfill.filled) || !Array.isArray(backfill.skipped)) {
    throw new Error("Backfill response must include filled and skipped arrays");
  }
}

export async function waitForServer(base: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/portfolio/status`);
      if (res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server not ready at ${base} within ${timeoutMs}ms (${lastErr})`);
}
