import type { Asset } from './types';

export const ASSET_LOGO_OVERRIDES_STORAGE_KEY = 'bors_asset_logo_overrides';

export const ASSET_LOGO_OVERRIDES_CHANGED_EVENT = 'bors-asset-logo-overrides-changed';

const PARQET_LOGO_BASE = 'https://assets.parqet.com/logos/symbol';

/** Reliable Bitcoin logos (Parqet last — some tickers 404 or return wrong art). */
export const BITCOIN_LOGO_URLS: readonly string[] = [
  'https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png',
  'https://cryptologos.cc/logos/bitcoin-btc-logo.png',
  `${PARQET_LOGO_BASE}/BTC?format=png`,
];

/** Manual display tickers → Parqet crypto symbol (Bitcoin, Ethereum, …). */
const CRYPTO_DISPLAY_TICKER_SYMBOLS: Record<string, string> = {
  BTC: 'BTC',
  ETH: 'ETH',
};

/** Known ETF issuers — longest prefixes first for greedy match at start of name. */
const ETF_ISSUER_PREFIXES: { prefix: string; domain: string }[] = [
  { prefix: 'JPMorgan Chase', domain: 'jpmorgan.com' },
  { prefix: 'J.P. Morgan', domain: 'jpmorgan.com' },
  { prefix: 'JPMorgan', domain: 'jpmorgan.com' },
  /** J.P. Morgan ETF share classes (e.g. JEPG) use "JPM " in the fund name, not "JPMorgan". */
  { prefix: 'JPM ', domain: 'jpmorgan.com' },
  { prefix: 'Goldman Sachs', domain: 'goldmansachs.com' },
  { prefix: 'Morgan Stanley', domain: 'morganstanley.com' },
  { prefix: 'Franklin Templeton', domain: 'franklintempleton.com' },
  { prefix: 'Legal & General', domain: 'legalandgeneral.com' },
  { prefix: 'State Street', domain: 'statestreet.com' },
  { prefix: 'Global X', domain: 'globalxetfs.com' },
  { prefix: 'First Trust', domain: 'ftportfolios.com' },
  { prefix: 'Hamilton Lane', domain: 'hamiltonlane.com' },
  { prefix: 'Roundhill', domain: 'roundhillinvestments.com' },
  { prefix: 'KraneShares', domain: 'kraneshares.com' },
  { prefix: 'Bitwise', domain: 'bitwiseinvestments.com' },
  { prefix: 'Coinbase', domain: 'coinbase.com' },
  { prefix: 'CoinShares', domain: 'coinshares.com' },
  { prefix: '21Shares', domain: '21shares.com' },
  { prefix: 'BlackRock', domain: 'blackrock.com' },
  { prefix: 'WisdomTree', domain: 'wisdomtree.com' },
  { prefix: 'Vanguard', domain: 'vanguard.com' },
  { prefix: 'Invesco', domain: 'invesco.com' },
  { prefix: 'Fidelity', domain: 'fidelity.com' },
  { prefix: 'Schwab', domain: 'schwab.com' },
  { prefix: 'ProShares', domain: 'proshares.com' },
  { prefix: 'Xtrackers', domain: 'xtrackers.com' },
  { prefix: 'VanEck', domain: 'vaneck.com' },
  { prefix: 'Amundi', domain: 'amundi.com' },
  { prefix: 'Lyxor', domain: 'amundietf.com' },
  { prefix: 'iShares', domain: 'ishares.com' },
  { prefix: 'SPDR', domain: 'ssga.com' },
  { prefix: 'PIMCO', domain: 'pimco.com' },
  { prefix: 'Nordea', domain: 'nordea.com' },
  { prefix: 'Danske', domain: 'danskebank.com' },
  { prefix: 'HSBC', domain: 'hsbc.com' },
  { prefix: 'UBS', domain: 'ubs.com' },
  { prefix: 'BNP', domain: 'bnpparibas-am.com' },
  { prefix: 'Natixis', domain: 'natixis.com' },
  { prefix: 'Ossiam', domain: 'ossiam.com' },
  { prefix: 'Tabula', domain: 'tabulaim.com' },
  { prefix: 'Pacer', domain: 'paceretfs.com' },
  { prefix: 'Defiance', domain: 'defianceetfs.com' },
  { prefix: 'HANetf', domain: 'haneetf.com' },
  { prefix: 'HanETF', domain: 'haneetf.com' },
  { prefix: 'Grayscale', domain: 'grayscale.com' },
  { prefix: 'ARK ', domain: 'ark-invest.com' },
  { prefix: 'ARK', domain: 'ark-invest.com' },
  { prefix: 'Evli', domain: 'evli.com' },
  { prefix: 'Aktia', domain: 'aktia.fi' },
  { prefix: 'SEB', domain: 'sebgroup.com' },
  { prefix: 'DWS', domain: 'dws.com' },
  { prefix: 'LGIM', domain: 'legalandgeneral.com' },
  { prefix: 'Nuveen', domain: 'nuveen.com' },
  { prefix: 'Kurv', domain: 'kurv.com' },
  { prefix: 'Simplify', domain: 'simplify.us' },
];

/**
 * Parqet tickers that 404 or resolve to the wrong company (e.g. XBT → 404,
 * GBT/GBTC → Grayscale purple "G"). Prefer issuer heuristics first.
 */
const PARQET_SKIP_SYMBOLS = new Set([
  'XBT',
  'XBTE',
  'BITCOIN',
  'BITCOINXBT',
  'GBT',
  'GBTC',
]);

const NORDIC_EXCHANGE_SUFFIX =
  /\.(HE|ST|CO|SW|FH|DE|F|PA|AS|BR|OL|T|V|L|MI|IC|IR|LS|MC|BE|DU|HA|MU|SG|TW)$/i;

export function isNordicExchangeTicker(ticker: string): boolean {
  return NORDIC_EXCHANGE_SUFFIX.test(ticker.trim());
}

export function notifyAssetLogoOverridesChanged(): void {
  window.dispatchEvent(new Event(ASSET_LOGO_OVERRIDES_CHANGED_EVENT));
}

export function loadAssetLogoOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(ASSET_LOGO_OVERRIDES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof k === 'string' && typeof v === 'string' && v.trim()) {
        out[k.trim().toUpperCase()] = v.trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveAssetLogoOverrides(overrides: Record<string, string>): void {
  localStorage.setItem(ASSET_LOGO_OVERRIDES_STORAGE_KEY, JSON.stringify(overrides));
  notifyAssetLogoOverridesChanged();
}

export function assetLogoOverrideKey(ticker: string | null | undefined): string | null {
  const sym = logoSymbolFromTicker(ticker ?? '');
  return sym;
}

/** Strip exchange suffix (.HE, .MI, .F) for logo CDN lookup. */
export function logoSymbolFromTicker(ticker: string): string | null {
  const t = ticker.trim();
  if (!t || t === '—') return null;
  const base = (t.includes('.') ? t.split('.')[0]! : t).replace(/-/g, '');
  const sym = base.toUpperCase();
  return sym.length > 0 ? sym : null;
}

export function parqetSymbolLogoUrl(symbol: string): string {
  return `${PARQET_LOGO_BASE}/${encodeURIComponent(symbol)}?format=png`;
}

/** True when the UI display ticker is a known crypto override (e.g. BTC on XBT.HE). */
export function isCryptoDisplayTicker(ticker: string): boolean {
  const sym = logoSymbolFromTicker(ticker);
  return sym != null && sym in CRYPTO_DISPLAY_TICKER_SYMBOLS;
}

/** Logo for display-only crypto tickers; does not apply to underlying ETP symbols like XBT. */
export function cryptoDisplayTickerLogoUrl(ticker: string): string | null {
  const sym = logoSymbolFromTicker(ticker);
  if (!sym) return null;
  if (sym === 'BTC') return BITCOIN_LOGO_URLS[0]!;
  const parqetSym = CRYPTO_DISPLAY_TICKER_SYMBOLS[sym];
  if (!parqetSym) return null;
  return parqetSymbolLogoUrl(parqetSym);
}

/** Same display ticker logic as holdings / dividends tables. */
export function displayTickerForAsset(asset: {
  displaySymbol?: string | null;
  symbol: string;
}): string {
  const d = asset.displaySymbol?.trim();
  if (d) return d.toUpperCase();
  const s = asset.symbol.trim();
  return (s.includes('.') ? s.split('.')[0]! : s).toUpperCase();
}

function isXbtListingSymbol(sym: string | null): boolean {
  if (!sym) return false;
  if (sym === 'XBT' || sym === 'XBTE' || sym === 'BITCOINXBT') return true;
  return /^BITCOINXBT$/i.test(sym);
}

/** Use Bitcoin artwork when display ticker is BTC or the holding is an XBT tracker product. */
export function shouldPreferBitcoinLogo(
  displayTicker: string,
  name: string,
  yahooSymbol?: string | null
): boolean {
  const sym = logoSymbolFromTicker(displayTicker);
  if (sym === 'BTC') return true;
  const ySym = logoSymbolFromTicker(yahooSymbol ?? '');
  if (!/bitcoin\s+tracker/i.test(name.trim())) return false;
  return isXbtListingSymbol(ySym) || isXbtListingSymbol(sym);
}

/** Ticker used only for logo CDN lookup (may differ from UI label). */
export function resolveLogoTicker(
  displayTicker: string,
  name: string,
  yahooSymbol?: string | null
): string {
  if (shouldPreferBitcoinLogo(displayTicker, name, yahooSymbol)) return 'BTC';
  return displayTicker.trim();
}

export function issuerFaviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

export function isLikelyEtf(
  type: Asset['type'] | undefined,
  name: string
): boolean {
  if (type === 'etf') return true;
  return /\b(ETF|ETN|ETP|UCITS|Fund)\b/i.test(name);
}

export function detectEtfIssuerFromName(name: string): { label: string; logoUrl: string } | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  for (const { prefix, domain } of ETF_ISSUER_PREFIXES) {
    if (lower.startsWith(prefix.toLowerCase())) {
      return { label: prefix.trim(), logoUrl: issuerFaviconUrl(domain) };
    }
  }
  return null;
}

/** Crypto ETP / certificate logos from ticker + name (before Parqet). */
export function detectKnownCryptoEtpLogo(
  ticker: string,
  name: string,
  type?: Asset['type']
): string | null {
  if (isCryptoDisplayTicker(ticker)) return null;

  const trimmed = name.trim();
  if (!trimmed && !ticker.trim()) return null;

  const lower = trimmed.toLowerCase();
  const sym = logoSymbolFromTicker(ticker);
  const listingSym =
    sym === 'BITCOINXBT' || (sym != null && /^BITCOINXBT$/i.test(sym)) ? 'XBT' : sym;
  const isEtpLike =
    isLikelyEtf(type, trimmed) ||
    type === 'crypto' ||
    /bitcoin\s+tracker|physical\s+bitcoin|\betp\b/i.test(lower);
  if (!isEtpLike) return null;

  const hasCoinbase = /\bcoinbase\b/i.test(trimmed);
  const hasBitcoinTracker = /bitcoin\s+tracker/i.test(lower);
  const hasXbtProvider = /xbt\s+provider|\bcoinshares\b/i.test(lower);
  const nordic =
    isNordicExchangeTicker(ticker) ||
    listingSym === 'XBT' ||
    listingSym === 'XBTE' ||
    listingSym === 'BITCOINXBT';

  if (
    hasCoinbase &&
    (hasBitcoinTracker || /physical\s+bitcoin/i.test(lower))
  ) {
    return issuerFaviconUrl('coinbase.com');
  }
  if (listingSym === 'CBTC' && hasCoinbase) {
    return issuerFaviconUrl('coinbase.com');
  }
  if (listingSym === 'XBT' && hasCoinbase) {
    return issuerFaviconUrl('coinbase.com');
  }
  /** Nordic XBT "Bitcoin Tracker" without legacy CoinShares branding → Coinbase ETP. */
  if (listingSym === 'XBT' && nordic && hasBitcoinTracker && !hasXbtProvider) {
    return issuerFaviconUrl('coinbase.com');
  }
  if (hasXbtProvider) {
    return issuerFaviconUrl('coinshares.com');
  }
  /** Parqet maps GBT/GBTC to Grayscale; override when the fund is Coinbase-branded. */
  if (
    (sym === 'GBT' || sym === 'GBTC') &&
    (hasCoinbase || (hasBitcoinTracker && !/^grayscale\b/i.test(trimmed)))
  ) {
    return issuerFaviconUrl('coinbase.com');
  }

  return null;
}

export function shouldSkipParqetSymbol(
  symbol: string,
  ticker: string,
  name: string,
  type?: Asset['type']
): boolean {
  if (PARQET_SKIP_SYMBOLS.has(symbol)) return true;
  if (detectKnownCryptoEtpLogo(ticker, name, type)) return true;
  return false;
}

export function logoInitials(
  ticker: string,
  name: string,
  yahooSymbol?: string | null
): string {
  if (shouldPreferBitcoinLogo(ticker, name, yahooSymbol)) return 'BTC';
  const sym = logoSymbolFromTicker(ticker);
  if (sym === 'BTC') return 'BTC';
  if (sym) return sym.slice(0, 2);
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]![0] ?? ''}${words[1]![0] ?? ''}`.toUpperCase();
  }
  const trimmed = name.trim();
  return (trimmed.length >= 2 ? trimmed.slice(0, 2) : trimmed.slice(0, 1) || '?').toUpperCase();
}

export type AssetLogoSource = 'override' | 'prop' | 'crypto' | 'issuer' | 'parqet';

/**
 * Fallback order after each `onError`:
 * Bitcoin (display BTC or XBT Bitcoin Tracker):
 *   1–3. CoinGecko → CryptoLogos → Parqet BTC
 *   4. Manual override / prop
 *   (no issuer or Parqet for the listing symbol — avoids Grayscale G on GBT/XBT)
 * Other assets:
 *   1. Manual → crypto display → issuer → Parqet → initials
 */
export function resolveAssetLogoSources(input: {
  ticker: string;
  name: string;
  type?: Asset['type'];
  logoUrl?: string | null;
  overrides?: Record<string, string>;
  yahooSymbol?: string | null;
}): {
  chain: AssetLogoSource[];
  initials: string;
  cryptoUrls: string[];
  parqetUrl: string | null;
  issuerUrl: string | null;
  manualUrl: string | null;
} {
  const { ticker, name, type, logoUrl, overrides = {}, yahooSymbol } = input;
  const preferBitcoin = shouldPreferBitcoinLogo(ticker, name, yahooSymbol);
  const logoTicker = resolveLogoTicker(ticker, name, yahooSymbol);
  const symbol = logoSymbolFromTicker(logoTicker);
  const initials = logoInitials(ticker, name, yahooSymbol);

  const cryptoUrls: string[] = preferBitcoin
    ? [...BITCOIN_LOGO_URLS]
    : (() => {
        const u = cryptoDisplayTickerLogoUrl(logoTicker);
        return u ? [u] : [];
      })();

  const knownCryptoUrl = preferBitcoin ? null : detectKnownCryptoEtpLogo(ticker, name, type);
  const issuerFromName =
    !preferBitcoin && isLikelyEtf(type, name) && !isCryptoDisplayTicker(ticker)
      ? detectEtfIssuerFromName(name)
      : null;
  const issuerUrl = knownCryptoUrl ?? issuerFromName?.logoUrl ?? null;

  const skipParqet =
    preferBitcoin || (symbol ? shouldSkipParqetSymbol(symbol, ticker, name, type) : false);
  const parqetUrl =
    !preferBitcoin && symbol && !skipParqet && cryptoUrls.length === 0
      ? parqetSymbolLogoUrl(symbol)
      : null;

  const overrideKey = assetLogoOverrideKey(ticker);
  const storedOverride =
    overrideKey && overrides[overrideKey] ? overrides[overrideKey]! : null;
  const manualUrl = (logoUrl?.trim() || storedOverride) || null;

  const chain: AssetLogoSource[] = [];
  for (let i = 0; i < cryptoUrls.length; i++) chain.push('crypto');
  if (manualUrl) chain.push(logoUrl?.trim() ? 'prop' : 'override');
  if (!preferBitcoin) {
    if (issuerUrl) chain.push('issuer');
    if (parqetUrl) chain.push('parqet');
  }

  return { chain, initials, cryptoUrls, parqetUrl, issuerUrl, manualUrl };
}

export function urlForLogoSource(
  source: AssetLogoSource,
  ctx: {
    manualUrl: string | null;
    cryptoUrls: string[];
    parqetUrl: string | null;
    issuerUrl: string | null;
  },
  cryptoIndex = 0
): string | null {
  switch (source) {
    case 'prop':
    case 'override':
      return ctx.manualUrl;
    case 'crypto':
      return ctx.cryptoUrls[cryptoIndex] ?? null;
    case 'parqet':
      return ctx.parqetUrl;
    case 'issuer':
      return ctx.issuerUrl;
    default:
      return null;
  }
}
