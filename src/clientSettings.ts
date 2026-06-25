/**
 * Browser settings stored in localStorage — synced to SQLite via /api/portfolio/client-settings
 * so Electron installs and JSON backup keep dividend/FIRE/logo data.
 */
import { ASSET_LOGO_OVERRIDES_STORAGE_KEY } from './assetLogo';
import { BLENDED_YIELD_KEY } from './blendedYieldCache';
import { DIVIDEND_INFO_LINKS_STORAGE_KEY } from './dividendInfoLinks';
import { REDEEMED_DIVIDENDS_STORAGE_KEY } from './dividendRedemptions';
import { MANUAL_DIVIDENDS_STORAGE_KEY } from './manualDividends';
import { FIRE_STORAGE_KEY } from './fireStorage';
import { REDEEM_MUTE_STORAGE_KEY } from './redeemDividendFeedback';

export const CLIENT_SETTINGS_KEYS = [
  MANUAL_DIVIDENDS_STORAGE_KEY,
  DIVIDEND_INFO_LINKS_STORAGE_KEY,
  ASSET_LOGO_OVERRIDES_STORAGE_KEY,
  REDEEMED_DIVIDENDS_STORAGE_KEY,
  REDEEM_MUTE_STORAGE_KEY,
  FIRE_STORAGE_KEY,
  BLENDED_YIELD_KEY,
] as const;

export type ClientSettingsSnapshot = Record<string, unknown>;

/** Read all known keys from localStorage (parsed JSON when valid). */
export function collectClientSettingsFromLocalStorage(): ClientSettingsSnapshot {
  const out: ClientSettingsSnapshot = {};
  for (const key of CLIENT_SETTINGS_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null || raw === '') continue;
      try {
        out[key] = JSON.parse(raw) as unknown;
      } catch {
        out[key] = raw;
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** Write snapshot into localStorage and notify listeners where applicable. */
export function applyClientSettingsToLocalStorage(snapshot: ClientSettingsSnapshot | null | undefined): void {
  if (!snapshot || typeof snapshot !== 'object') return;
  for (const key of CLIENT_SETTINGS_KEYS) {
    if (!(key in snapshot)) continue;
    const v = snapshot[key];
    try {
      if (v === null || v === undefined) {
        localStorage.removeItem(key);
      } else if (typeof v === 'string') {
        localStorage.setItem(key, v);
      } else {
        localStorage.setItem(key, JSON.stringify(v));
      }
    } catch {
      /* ignore */
    }
  }
  window.dispatchEvent(new Event('bors-client-settings-applied'));
}
