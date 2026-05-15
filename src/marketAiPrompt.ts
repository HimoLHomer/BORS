/** User prompt for the Market Intelligence AI summary panel. */

export const MARKET_AI_SUMMARY_PROMPT = `Today’s market headlines only. Reply in English markdown with exactly two sections and no other text.



## Global

- (bullet 1: main global index or macro driver today)

- (bullet 2: rates, FX, or commodities headline)

- (bullet 3: one geopolitical or policy headline if relevant today)



## Finland

- (bullet 1: OMX Helsinki / Finnish market headline today)

- (bullet 2: key Finnish company or sector move today)

- (bullet 3: local macro or policy headline if relevant today)



Rules: max 6 bullets total; each bullet one short sentence; today only; no intro paragraph; no disclaimers; no investment advice; no history lessons.`;



export const MARKET_AI_GENERATION_CONFIG = {
  maxOutputTokens: 1024,
  temperature: 0.2,
} as const;

export const MARKET_INDEX_AI_CONFIG = {
  ...MARKET_AI_GENERATION_CONFIG,
  systemInstruction:
    'Output exactly three markdown bullet lines. No headings, no intro sentence, no paragraph.',
} as const;



export type MarketAiQuoteContext = {

  label: string;

  price: number | null;

  changePercent: number;

  currency: string;

};



function fmtLevel(price: number | null, currency: string): string {

  if (price == null || !Number.isFinite(price)) return "level unavailable";

  return `${price.toFixed(2)} ${currency}`;

}



function fmtPct(pct: number): string {

  if (!Number.isFinite(pct)) return "0%";

  const sign = pct > 0 ? "+" : "";

  return `${sign}${pct.toFixed(2)}%`;

}



/** Short “why is it moving” prompt for US index panel. */

export function buildUsMarketAiPrompt(q: MarketAiQuoteContext): string {

  return `The ${q.label} index is at ${fmtLevel(q.price, q.currency)} and ${fmtPct(q.changePercent)} today.



Write exactly 3 bullets (one short sentence each) on why US / global equities moved today. Macro, sectors, headlines only.

Format (copy exactly):
- First driver.
- Second driver.
- Third driver.`;

}



/** Short “why is it moving” prompt for Finnish index panel. */

export function buildFiMarketAiPrompt(q: MarketAiQuoteContext): string {

  return `The ${q.label} index is at ${fmtLevel(q.price, q.currency)} and ${fmtPct(q.changePercent)} today.



Write exactly 3 bullets (one short sentence each) on why Finnish / Nordic equities moved today. OMX, local names, EUR macro if relevant.

Format (copy exactly):
- First driver.
- Second driver.
- Third driver.`;

}


