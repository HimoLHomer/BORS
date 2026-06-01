/** Post-generation checks for index AI summaries. */

import { formatPercentFi } from "./formatNumber";

export type MarketSummaryValidationContext = {
  indexLabel: string;
  changePercent: number;
  marketDate: string;
  /** Company names from heatmap (e.g. Hiab, Wärtsilä). */
  moverNames: string[];
  /** Symbols only used to detect forbidden ticker text in output. */
  moverSymbols: string[];
  flatDayThreshold?: number;
};

const FUTURE_TENSE =
  /\b(is due|will release|will be released|will report|upcoming|expected on|scheduled for|due on|due tomorrow|expecting|expected to|soon)\b/i;

const ADMIN_NOISE =
  /\b(removed from trading|delisted|notes were removed|suspension of trading)\b/i;

const EARNINGS_HINT =
  /\b(earnings|revenue|eps|beat estimates|exceeded analyst|q[1-4]\b|quarterly report)\b/i;

const PCT_IN_TEXT = /[+-]?\d+(?:[.,]\d+)?\s*%/;

const EXCHANGE_TICKER = /\b[A-Z][A-Z0-9]{0,5}\.(HE|ST|OL|CO|US|PA|MI|DE|L)\b/i;

function normalizeSymbol(symbol: string): string {
  return symbol.split(".")[0]?.toUpperCase() ?? symbol.toUpperCase();
}

function indexKeywords(label: string): string[] {
  const keys = [label];
  if (/s&p|sp500|500/i.test(label)) keys.push("S&P", "S&P 500");
  if (/omx|helsinki/i.test(label)) keys.push("OMX", "Helsinki");
  return keys;
}

function bulletLines(summary: string): string[] {
  return summary
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("-"));
}

export type MoverQuote = {
  symbol: string;
  name: string;
  changePercent: number;
};

/** Short label for text (e.g. "Nokia Oyj" → "Nokia"). */
export function displayCompanyLabel(name: string, symbol: string): string {
  const n = name.trim();
  if (!n) return normalizeSymbol(symbol);
  const first = n.split(/\s+/)[0];
  return first && first.length >= 2 ? first : n;
}

/** Match bullet text to a company display name. */
function mentionsCompanyName(bullet: string, companyName: string): boolean {
  const lower = bullet.toLowerCase();
  const name = companyName.trim();
  if (!name) return false;
  if (lower.includes(name.toLowerCase())) return true;
  const first = name.split(/\s+/)[0];
  if (first && first.length >= 3 && lower.includes(first.toLowerCase())) return true;
  return false;
}

function bulletReferencesMover(bullet: string, mover: MoverQuote): boolean {
  if (mentionsCompanyName(bullet, mover.name)) return true;
  const base = normalizeSymbol(mover.symbol);
  return new RegExp(`\\b${base}(?:\\.[A-Z]{1,3})?\\b`, "i").test(bullet);
}

function replaceTickersInBullet(bullet: string, movers: MoverQuote[]): string {
  let line = bullet;
  for (const m of movers) {
    const base = normalizeSymbol(m.symbol);
    const label = displayCompanyLabel(m.name, m.symbol);
    line = line.replace(new RegExp(`\\b${base}\\.[A-Z]{1,3}\\b`, "gi"), label);
    line = line.replace(new RegExp(`\\b${base}\\b`, "gi"), label);
  }
  return line;
}

export function validateMarketSummary(
  summary: string,
  ctx: MarketSummaryValidationContext
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const bullets = bulletLines(summary);
  const flatThreshold = ctx.flatDayThreshold ?? 0.3;
  const isFlat = Math.abs(ctx.changePercent) < flatThreshold;
  const moverBases = ctx.moverSymbols.map(normalizeSymbol).filter(Boolean);
  const idxKeys = indexKeywords(ctx.indexLabel);

  if (bullets.length < 2) {
    reasons.push("Fewer than 2 bullet lines.");
  }

  const joined = bullets.join(" ");

  if (FUTURE_TENSE.test(joined)) {
    reasons.push("Contains future/upcoming events (use only what happened on the market date).");
  }

  if (ADMIN_NOISE.test(joined)) {
    reasons.push("Contains listing/admin noise unrelated to index move.");
  }

  if (EXCHANGE_TICKER.test(joined)) {
    reasons.push("Use company names only — no exchange tickers (e.g. HIAB.HE, WRT1V.HE).");
  }

  for (const base of moverBases) {
    if (base.length >= 2 && new RegExp(`\\b${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(joined)) {
      reasons.push(`Do not use ticker ${base}; use the company name from the heatmap.`);
      break;
    }
  }

  const mentionsIndex = bullets.some((b) =>
    idxKeys.some((k) => b.toLowerCase().includes(k.toLowerCase()))
  );
  const mentionsSessionPct =
    bullets.some((b) => PCT_IN_TEXT.test(b)) ||
    joined.toLowerCase().includes(fmtMoveWord(ctx.changePercent));

  if (!mentionsIndex && !mentionsSessionPct) {
    reasons.push(
      `No bullet ties to ${ctx.indexLabel} or today's session move (${fmtPct(ctx.changePercent)}).`
    );
  }

  if (ctx.moverNames.length > 0) {
    const bulletsWithMover = bullets.filter((b) =>
      ctx.moverNames.some((name) => mentionsCompanyName(b, name))
    );
    if (bulletsWithMover.length < 2) {
      reasons.push(
        `At least 2 bullets must name a heatmap company (${ctx.moverNames.slice(0, 3).join(", ")}).`
      );
    }
    const bulletsWithMoverPct = bulletsWithMover.filter((b) => PCT_IN_TEXT.test(b));
    if (bulletsWithMover.length >= 2 && bulletsWithMoverPct.length < 1) {
      reasons.push("At least one company bullet must include that stock's % move.");
    }
  }

  if (!isFlat) {
    const earningsBullets = bullets.filter((b) => EARNINGS_HINT.test(b)).length;
    if (earningsBullets > 1) {
      reasons.push("At most one earnings bullet unless the index is flat; add macro or index-level driver.");
    }
  }

  return { ok: reasons.length === 0, reasons };
}

function fmtPct(pct: number): string {
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function fmtMoveWord(pct: number): string {
  if (Math.abs(pct) < 0.05) return "flat";
  return pct > 0 ? "up" : "down";
}

function fixPercentInBullet(bullet: string, exactPct: string): string {
  if (!PCT_IN_TEXT.test(bullet)) return bullet;
  return bullet.replace(PCT_IN_TEXT, exactPct);
}

/** Replace tickers with company names and snap % to heatmap/overview. */
export function sanitizeMarketSummary(
  summary: string,
  ctx: {
    indexLabel: string;
    changePercent: number;
    movers: MoverQuote[];
    topGainer?: MoverQuote;
    topLoser?: MoverQuote;
  }
): string {
  const bullets = bulletLines(summary);
  if (bullets.length === 0) return summary;

  const idxKeys = indexKeywords(ctx.indexLabel);
  const indexPct = formatPercentFi(ctx.changePercent, 2, { showPlus: true });
  const allMovers = ctx.movers.length > 0 ? ctx.movers : [ctx.topGainer, ctx.topLoser].filter(Boolean) as MoverQuote[];

  const fixed = bullets.map((bullet, i) => {
    let line = replaceTickersInBullet(bullet, allMovers);

    if (i === 0 && idxKeys.some((k) => line.toLowerCase().includes(k.toLowerCase()))) {
      line = fixPercentInBullet(line, indexPct);
    }
    if (ctx.topGainer && bulletReferencesMover(line, ctx.topGainer)) {
      line = fixPercentInBullet(
        line,
        formatPercentFi(ctx.topGainer.changePercent, 2, { showPlus: true })
      );
    }
    if (ctx.topLoser && bulletReferencesMover(line, ctx.topLoser)) {
      line = fixPercentInBullet(
        line,
        formatPercentFi(ctx.topLoser.changePercent, 2, { showPlus: true })
      );
    }
    return line;
  });

  return fixed.join("\n");
}

export function buildMarketSummaryRetrySuffix(
  reasons: string[],
  ctx: MarketSummaryValidationContext
): string {
  const movers = ctx.moverNames.slice(0, 6).join(", ") || "(none)";
  return `

REJECTED — fix and output only 3 bullets:
${reasons.map((r) => `- ${r}`).join("\n")}

Rewrite rules:
- Bullet 1: Why ${ctx.indexLabel} moved ${fmtPct(ctx.changePercent)} on ${ctx.marketDate} (macro/geopolitics/rates released that day).
- Bullet 2: Top heatmap gainer — company name (${movers}) + stock % + one fact. No tickers.
- Bullet 3: Top heatmap loser — company name + stock % + one fact. No tickers.
- No future events ("is due", "will report"). No delistings. Max one earnings line.`;
}
