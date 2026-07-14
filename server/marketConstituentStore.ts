import fs from "fs";
import path from "path";
import { appRoot } from "./appRoot";
import {
  fetchOmxh25Constituents,
  fetchSp500Constituents,
  type MarketConstituent,
} from "./wikipediaConstituents";

export type { MarketConstituent };

const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CONSTITUENT_FILES = ["sp500.json", "omxh25.json"] as const;

type SyncMeta = { lastSyncAt: string };

let syncInFlight: Promise<boolean> | null = null;
let onSyncComplete: (() => void) | null = null;

/** Register callback after a successful runtime sync (e.g. clear heatmap cache). */
export function onMarketConstituentsSynced(cb: () => void): void {
  onSyncComplete = cb;
}

/** Writable cache: Electron userData, or `.cache/market` in dev. */
export function constituentCacheDir(): string {
  const userData = process.env.BORS_USER_DATA?.trim();
  if (userData) return path.join(userData, "market");
  return path.join(appRoot(), ".cache", "market");
}

function bundledConstituentPath(file: string): string {
  const candidates = [
    path.join(appRoot(), "assets", "market", file),
    path.join(appRoot(), "data", "market", file),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(`Missing constituent file: ${candidates.join(" or ")}`);
  }
  return found;
}

function cachedConstituentPath(file: string): string {
  return path.join(constituentCacheDir(), file);
}

function metaPath(): string {
  return path.join(constituentCacheDir(), "sync-meta.json");
}

function readJsonFile(file: string): MarketConstituent[] {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`${file} is not an array`);
  return parsed as MarketConstituent[];
}

function writeJsonFile(file: string, data: MarketConstituent[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data)}\n`, "utf8");
}

function validateConstituents(file: string, rows: MarketConstituent[]): void {
  for (const row of rows) {
    if (!row.symbol?.trim()) throw new Error(`${file}: empty symbol`);
    if (!row.name?.trim()) throw new Error(`${file}: empty name for ${row.symbol}`);
    if (!row.sector?.trim()) throw new Error(`${file}: empty sector for ${row.symbol}`);
    if (/\s/.test(row.symbol)) throw new Error(`${file}: symbol contains spaces: ${row.symbol}`);
  }
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.symbol)) throw new Error(`${file}: duplicate symbol ${row.symbol}`);
    seen.add(row.symbol);
  }
  if (file.includes("sp500")) {
    if (rows.length < 490 || rows.length > 510) {
      throw new Error(`sp500.json count ${rows.length} outside 490–510`);
    }
  } else if (file.includes("omxh25")) {
    if (rows.length !== 25) throw new Error(`omxh25.json count ${rows.length} (expected 25)`);
    for (const row of rows) {
      if (!row.symbol.endsWith(".HE")) {
        throw new Error(`omxh25.json: ${row.symbol} missing .HE suffix`);
      }
    }
  }
}

function readSyncMeta(): SyncMeta | null {
  const p = metaPath();
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as SyncMeta;
    if (typeof parsed.lastSyncAt === "string" && parsed.lastSyncAt.trim()) return parsed;
  } catch {
    /* treat as missing */
  }
  return null;
}

function writeSyncMetaFile(): void {
  const p = metaPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    `${JSON.stringify({ lastSyncAt: new Date().toISOString() } satisfies SyncMeta)}\n`,
    "utf8"
  );
}

function syncIsStale(now = Date.now()): boolean {
  const meta = readSyncMeta();
  if (!meta) return true;
  const last = Date.parse(meta.lastSyncAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= SYNC_INTERVAL_MS;
}

function logDiff(label: string, prev: MarketConstituent[], next: MarketConstituent[]): void {
  const prevSyms = new Set(prev.map((c) => c.symbol));
  const nextSyms = new Set(next.map((c) => c.symbol));
  const added = next.filter((c) => !prevSyms.has(c.symbol)).map((c) => c.symbol);
  const removed = prev.filter((c) => !nextSyms.has(c.symbol)).map((c) => c.symbol);
  if (added.length === 0 && removed.length === 0) return;
  console.log(
    `Market constituents ${label}: +${added.length}${added.length ? ` (${added.join(", ")})` : ""}, -${removed.length}${removed.length ? ` (${removed.join(", ")})` : ""}`
  );
}

/** Copy bundled JSON into cache when missing (first run). */
export function seedConstituentCacheFromBundled(): void {
  const dir = constituentCacheDir();
  fs.mkdirSync(dir, { recursive: true });
  for (const file of CONSTITUENT_FILES) {
    const cached = cachedConstituentPath(file);
    if (fs.existsSync(cached)) continue;
    const bundled = bundledConstituentPath(file);
    fs.copyFileSync(bundled, cached);
  }
}

export function loadMarketConstituents(universe: "sp500" | "omxh25"): MarketConstituent[] {
  const file = universe === "sp500" ? "sp500.json" : "omxh25.json";
  seedConstituentCacheFromBundled();
  const cached = cachedConstituentPath(file);
  if (fs.existsSync(cached)) return readJsonFile(cached);
  return readJsonFile(bundledConstituentPath(file));
}

export async function syncMarketConstituentsFromWikipedia(): Promise<boolean> {
  if (process.env.SYNC_CONSTITUENTS_SKIP === "1") return false;

  seedConstituentCacheFromBundled();
  const prevSp = readJsonFile(cachedConstituentPath("sp500.json"));
  const prevOmx = readJsonFile(cachedConstituentPath("omxh25.json"));

  const [sp500, omxh25] = await Promise.all([
    fetchSp500Constituents(),
    fetchOmxh25Constituents(),
  ]);

  validateConstituents("sp500.json", sp500);
  validateConstituents("omxh25.json", omxh25);

  logDiff("S&P 500", prevSp, sp500);
  logDiff("OMX Helsinki 25", prevOmx, omxh25);

  writeJsonFile(cachedConstituentPath("sp500.json"), sp500);
  writeJsonFile(cachedConstituentPath("omxh25.json"), omxh25);
  writeSyncMetaFile();

  onSyncComplete?.();
  return true;
}

/**
 * Background sync at most once per 24h. Safe to call on every server start / heatmap load.
 * Returns immediately; existing lists stay available while sync runs.
 */
export function startDailyConstituentSyncIfNeeded(): void {
  if (process.env.SYNC_CONSTITUENTS_SKIP === "1") return;
  seedConstituentCacheFromBundled();
  if (!syncIsStale()) return;
  if (syncInFlight) return;

  syncInFlight = syncMarketConstituentsFromWikipedia()
    .catch((e) => {
      console.warn(
        "Daily market constituent sync failed (using cached lists):",
        e instanceof Error ? e.message : e
      );
      return false;
    })
    .finally(() => {
      syncInFlight = null;
    });
}

export function isConstituentSyncRunning(): boolean {
  return syncInFlight != null;
}
