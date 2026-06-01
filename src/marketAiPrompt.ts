/** Prompts and config for Market Intelligence index AI summaries. */

import { formatPercentFi } from "./formatNumber";
import { displayCompanyLabel } from "./marketAiValidation";

function normalizeSymbolForPrompt(symbol: string): string {
  return symbol.split(".")[0]?.toUpperCase() ?? symbol.toUpperCase();
}

function displayCompanyLabelForPrompt(name: string, symbol: string): string {
  return displayCompanyLabel(name, symbol);
}



export const MARKET_AI_GENERATION_CONFIG = {

  maxOutputTokens: 1024,

  temperature: 0.15,

} as const;



const BANNED_VAGUE_PHRASES =

  "investors are reacting, investors reacted, bolstered sentiment, positive sentiment, risk appetite, easing pressures, major technology companies, tech companies, geopolitical tensions, signs of easing, stabilizing as, broader market, institutional investors";



export const MARKET_INDEX_SYSTEM_INSTRUCTION = `Output exactly three markdown bullet lines. Each line starts with "- " (hyphen space). No headings, intro, or disclaimers. Max 24 words per bullet.



Bullet 1 = why the INDEX moved today (must include index name or session % move).

Bullet 2 = top heatmap GAINER: company name + stock % + one same-day fact.

Bullet 3 = top heatmap LOSER: company name + stock % + one same-day fact.

Use company names only (e.g. Hiab, Wärtsilä, Microsoft) — never exchange tickers (HIAB.HE, WRT1V.HE, MSFT, NVDA).

Each bullet: proper nouns + numbers. No future events ("is due", "will report"). No delistings/listing changes. Max one earnings line unless index is flat.

Never use: ${BANNED_VAGUE_PHRASES}.`;



export const MARKET_INDEX_AI_CONFIG = {

  ...MARKET_AI_GENERATION_CONFIG,

  systemInstruction: MARKET_INDEX_SYSTEM_INSTRUCTION,

} as const;



export const OPENAI_MARKET_SYSTEM_INSTRUCTION = `${MARKET_INDEX_SYSTEM_INSTRUCTION} You do not have live web access. Use heatmap movers and sector breadth; do not invent headlines.`;



export type MarketHeatmapMover = {

  symbol: string;

  name: string;

  changePercent: number;

};



export type MarketSectorBreadth = {

  leadingSector: string;

  leadingAvgPct: number;

  laggingSector: string;

  laggingAvgPct: number;

};



export type MarketAiQuoteContext = {

  label: string;

  price: number | null;

  changePercent: number;

  currency: string;

  marketDate: string;

  asOf?: string | null;

  topMovers?: {

    gainers: MarketHeatmapMover[];

    losers: MarketHeatmapMover[];

  };

  sectorBreadth?: MarketSectorBreadth;

};



function fmtLevel(price: number | null, currency: string): string {

  if (price == null || !Number.isFinite(price)) return "level unavailable";

  return `${price.toFixed(2)} ${currency}`;

}



/** Same formatting as heatmap labels (2 decimals, Finnish locale). */
function fmtPct(pct: number): string {
  if (!Number.isFinite(pct)) return "0 %";
  return formatPercentFi(pct, 2, { showPlus: true });
}



function moveDirection(pct: number): string {

  if (!Number.isFinite(pct) || Math.abs(pct) < 0.05) return "flat";

  return pct > 0 ? "up" : "down";

}



function formatMoversBlock(ctx: MarketAiQuoteContext): string {

  const g = ctx.topMovers?.gainers ?? [];

  const l = ctx.topMovers?.losers ?? [];

  if (g.length === 0 && l.length === 0) return "";

  const lines: string[] = [

    "Heatmap movers on screen (bullet 2 = top gainer, bullet 3 = top loser — copy % exactly as shown):",

  ];

  if (g.length) {

    lines.push(

      "Gainers: " +

        g
          .map(
            (m) =>
              `${displayCompanyLabelForPrompt(m.name, m.symbol)} ${fmtPct(m.changePercent)}`
          )
          .join("; ")

    );

  }

  if (l.length) {

    lines.push(

      "Losers: " +

        l
          .map(
            (m) =>
              `${displayCompanyLabelForPrompt(m.name, m.symbol)} ${fmtPct(m.changePercent)}`
          )
          .join("; ")

    );

  }

  return lines.join("\n") + "\n\n";

}



function formatSectorBlock(ctx: MarketAiQuoteContext): string {

  const b = ctx.sectorBreadth;

  if (!b) return "";

  return `Sector breadth: ${b.leadingSector} avg ${fmtPct(b.leadingAvgPct)} (strongest), ${b.laggingSector} avg ${fmtPct(b.laggingAvgPct)} (weakest).\n\n`;

}



const PROMPT_GOOD_BAD = `BAD (wrong structure — never write like this):

- Microsoft (MSFT) reported Q1 earnings, beating estimates with revenue of $82.89 billion.

- Broadcom (AVGO) announced Q1 revenue exceeding expectations.

- Costco (COST) reported Q3 net sales up 11.6% year-over-year.

(Three unrelated earnings — no index move, no heatmap tickers, no "why today".)



BAD:

- Eurozone May CPI release is due June 2, impacting ECB expectations.

(Future event, not today's driver.)



GOOD:

- S&P 500 +0.7% as May core CPI rose 0.1% m/m vs 0.2% expected, lifting Fed cut odds.

- Nvidia +4.2% after Q1 revenue beat; led Technology sector higher on the heatmap.

- Exxon Mobil −1.8% on Brent −2% after Iran–US talks in Oman eased supply fears.

BAD (tickers — never):

- HIAB.HE shares surged 7.70% following its acquisition of Labrie Environmental Group.`;



function searchQueriesForDate(marketDate: string, region: "us" | "fi"): string {

  if (region === "us") {

    return `Search ${marketDate} (published that day only):

- "S&P 500" + "${marketDate}" + "close" OR "market wrap"

- "CPI" OR "Fed" + "${marketDate}"

- heatmap company names + "${marketDate}" + "shares"

- "Iran" OR "tariffs" + "stocks ${marketDate}" only if relevant`;

  }

  return `Search ${marketDate} (published that day only):

- "OMX Helsinki" + "${marketDate}"

- "ECB" OR "eurozone" + "${marketDate}"

- heatmap company names + "${marketDate}" + "shares"`;

}



function buildIndexPrompt(ctx: MarketAiQuoteContext, region: "us" | "fi"): string {

  const dir = moveDirection(ctx.changePercent);

  const moversBlock = formatMoversBlock(ctx);

  const sectorBlock = formatSectorBlock(ctx);

  const asOfLine = ctx.asOf ? `Quote snapshot: ${ctx.asOf}.\n` : "";

  const searchQueries = searchQueriesForDate(ctx.marketDate, region);

  const topG = ctx.topMovers?.gainers[0];

  const topL = ctx.topMovers?.losers[0];

  const gainerLabel = topG
    ? displayCompanyLabelForPrompt(topG.name, topG.symbol)
    : null;
  const loserLabel = topL
    ? displayCompanyLabelForPrompt(topL.name, topL.symbol)
    : null;

  const gainerHint = topG
    ? `Bullet 2 must be about ${gainerLabel} only (${fmtPct(topG.changePercent)} — copy exactly). Never write ${topG.symbol} or ${normalizeSymbolForPrompt(topG.symbol)}.HE.`
    : "Bullet 2: strongest visible heatmap gainer by company name + stock %.";

  const loserHint = topL
    ? `Bullet 3 must be about ${loserLabel} only (${fmtPct(topL.changePercent)} — copy exactly). Never write ${topL.symbol} or ${normalizeSymbolForPrompt(topL.symbol)}.HE.`
    : "Bullet 3: weakest visible heatmap loser by company name + stock %.";



  return `Market date (Europe/Helsinki): ${ctx.marketDate}

${asOfLine}Index: ${ctx.label}

Level: ${fmtLevel(ctx.price, ctx.currency)}

Session move: ${fmtPct(ctx.changePercent)} (${dir})



${sectorBlock}${moversBlock}${searchQueries}



Write exactly 3 bullets (max 24 words each) explaining why ${ctx.label} moved on ${ctx.marketDate}.



Structure (mandatory):

1. ${ctx.label} moved ${fmtPct(ctx.changePercent)} — use this exact index % in bullet 1; add macro/rates/geopolitics from that day's news.

2. ${gainerHint} Same-day fact (earnings only if reported that date). Include stock %.

3. ${loserHint} Same-day fact. Include stock %.



Rules: facts from ${ctx.marketDate} only; no "is due" / "will report"; no delistings; max one earnings bullet; do not start with "Investors…"; company names only — no tickers or .HE/.ST suffixes; copy heatmap/index % exactly — do not round or use search for stock moves.



${PROMPT_GOOD_BAD}



No investment advice. Output only three "- " bullets.`;

}



export function buildUsMarketAiPrompt(ctx: MarketAiQuoteContext): string {

  return buildIndexPrompt(ctx, "us");

}



export function buildFiMarketAiPrompt(ctx: MarketAiQuoteContext): string {

  return buildIndexPrompt(ctx, "fi");

}



/** Top gainer/loser for AI bullets — only needs the extremes. */
export function pickTopHeatmapMovers(

  tiles: MarketHeatmapMover[],

  limit = 1

): { gainers: MarketHeatmapMover[]; losers: MarketHeatmapMover[] } {

  const valid = tiles.filter(

    (t) => t.symbol && Number.isFinite(t.changePercent)

  );

  const sorted = [...valid].sort((a, b) => b.changePercent - a.changePercent);

  const gainers = sorted.filter((t) => t.changePercent > 0).slice(0, limit);

  const losers = sorted

    .filter((t) => t.changePercent < 0)

    .slice(-limit)

    .reverse();

  return { gainers, losers };

}



export function computeSectorBreadth(

  sectors: { name: string; children: { change: number }[] }[]

): MarketSectorBreadth | undefined {

  const avgs: { name: string; avg: number }[] = [];

  for (const s of sectors) {

    if (!s.children.length) continue;

    const avg =

      s.children.reduce((sum, c) => sum + c.change, 0) / s.children.length;

    if (Number.isFinite(avg)) avgs.push({ name: s.name, avg });

  }

  if (avgs.length < 2) return undefined;

  const sorted = [...avgs].sort((a, b) => b.avg - a.avg);

  return {

    leadingSector: sorted[0]!.name,

    leadingAvgPct: sorted[0]!.avg,

    laggingSector: sorted[sorted.length - 1]!.name,

    laggingAvgPct: sorted[sorted.length - 1]!.avg,

  };

}


