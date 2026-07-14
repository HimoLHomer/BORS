import type { Express, Request, Response } from "express";
import {
  type DividendHoldingIn,
  type InferredDividendPayoutFrequency,
  type CalendarPayoutSource,
  yahooDividendSymbolFallbacks,
  trailingAnnualDividendPerShareFromChart,
  dividendBundleScore,
  chartDividendsToList,
  inferPayoutFrequencyFromChartDividends,
  dividendYieldPercentFromQuoteSummary,
  toIsoDate,
  buildCalendarPayoutSchedule,
} from "./dividendMath";
import {
  type CachedDividendBundle,
  DIVIDEND_BUNDLE_SCORE_GOOD_ENOUGH,
  DIVIDEND_CHART_LOOKBACK_DAYS,
  dividendFetchCacheKey,
  getCachedDividendBundle,
  setCachedDividendBundle,
} from "./dividendFetchCache";

export * from "./dividendMath";

type CandidateBundle = {
  divSym: string;
  sum: Record<string, unknown> | null;
  divList: { date?: Date | string; amount?: number }[];
  score: number;
};

async function fetchCandidateBundle(
  yahooFinance: any,
  candSym: string,
  p1: number,
  p2: number
): Promise<CandidateBundle> {
  try {
    const [sum, chartResult] = await Promise.all([
      yahooFinance.quoteSummary(
        candSym,
        {
          modules: ["summaryDetail", "calendarEvents", "price", "defaultKeyStatistics", "fundProfile"],
        },
        { validateResult: false }
      ),
      yahooFinance
        .chart(candSym, { period1: p1, period2: p2, interval: "1d", events: "div" }, { validateResult: false })
        .catch(() => null),
    ]);
    const divList = chartDividendsToList(chartResult?.events?.dividends);
    return {
      divSym: candSym,
      sum: sum as Record<string, unknown>,
      divList,
      score: dividendBundleScore(sum, divList),
    };
  } catch {
    return { divSym: candSym, sum: null, divList: [], score: -1 };
  }
}

async function resolveDividendBundle(
  yahooFinance: any,
  sym: string,
  displaySymbol: string | null | undefined
): Promise<CachedDividendBundle> {
  const cacheKey = dividendFetchCacheKey(sym, displaySymbol);
  const cached = getCachedDividendBundle(cacheKey);
  if (cached) return cached;

  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - 86400 * DIVIDEND_CHART_LOOKBACK_DAYS;
  const candidates = yahooDividendSymbolFallbacks(sym, displaySymbol);
  const listQuote = await yahooFinance.quote(sym).catch(() => null);

  let best: CandidateBundle | null = null;
  for (const candSym of candidates) {
    const bundle = await fetchCandidateBundle(yahooFinance, candSym, p1, p2);
    if (bundle.sum != null && bundle.score > (best?.score ?? -1)) {
      best = bundle;
    }
    if (best != null && best.score >= DIVIDEND_BUNDLE_SCORE_GOOD_ENOUGH) break;
  }

  const picked = best;
  if (!picked?.sum) {
    throw new Error(`No Yahoo dividend data for ${sym}`);
  }

  const divSym = picked.divSym;
  const fundQuote = divSym !== sym ? await yahooFinance.quote(divSym).catch(() => null) : null;
  const result: CachedDividendBundle = {
    divSym,
    sum: picked.sum,
    divList: picked.divList,
    fundQuote,
    listQuote,
  };
  setCachedDividendBundle(cacheKey, result);
  return result;
}

export function registerDividendRoutes(app: Express, yahooFinance: any): void {
  /** Under `/api/portfolio/*` so the same Express router as other portfolio APIs (avoids dev-only fallthrough). */
  app.post("/api/portfolio/dividends", async (req: Request, res: Response) => {
    try {
      const body = req.body as { holdings?: DividendHoldingIn[]; baseCurrency?: string };
      const holdings = Array.isArray(body.holdings) ? body.holdings : [];
      const baseCurrency = typeof body.baseCurrency === "string" && body.baseCurrency ? body.baseCurrency : "EUR";

      if (holdings.length === 0) {
        res.set("Cache-Control", "no-store");
        return res.json({
          baseCurrency,
          rates: { [baseCurrency]: 1 } as Record<string, number>,
          rows: [] as unknown[],
          totalAnnualIncomeEur: 0,
          totalHoldingsValueEur: 0,
          averagePortfolioYieldPercent: 0,
        });
      }

      const rates: Record<string, number> = { [baseCurrency]: 1 };
      const quoteCurrencies = new Set<string>();
      holdings.forEach((h) => {
        if (h.currency) quoteCurrencies.add(h.currency.toUpperCase());
      });

      type RowOut = {
        symbol: string;
        name: string;
        quantity: number;
        /** Currency of `annualDividendPerShare` (often `financialCurrency`, e.g. USD, while the listing trades in EUR). */
        quoteCurrency: string;
        /** Yahoo listing / `regularMarketPrice` currency (for converting reference price to EUR). */
        tradingCurrency: string;
        /** Same as `quoteCurrency` here — kept explicit for server-side FX. */
        dividendCurrency: string;
        /** Yahoo summary `regularMarketPrice` in `tradingCurrency` (fallback position value when dashboard price is missing). */
        yahooReferencePrice: number | null;
        dividendYieldPercent: number | null;
        annualDividendPerShare: number | null;
        annualDividendPerShareEur: number | null;
        estimatedAnnualIncomeEur: number;
        exDividendDate: string | null;
        dividendDate: string | null;
        /** Pay dates for the UI calendar (official Yahoo pay date, or projected from chart history). */
        calendarPayoutDates: string[];
        calendarPayoutSource: CalendarPayoutSource;
        payoutFrequency: InferredDividendPayoutFrequency | null;
        error: boolean;
      };

      const rows: RowOut[] = await Promise.all(
        holdings.map(async (h): Promise<RowOut> => {
          const qty = typeof h.quantity === "number" && Number.isFinite(h.quantity) ? h.quantity : 0;
          const sym = h.symbol?.trim();
          if (!sym) {
            const hc = (h.currency || baseCurrency).toUpperCase();
            return {
              symbol: "",
              name: "",
              quantity: qty,
              quoteCurrency: hc,
              tradingCurrency: hc,
              dividendCurrency: hc,
              yahooReferencePrice: null,
              dividendYieldPercent: null,
              annualDividendPerShare: null,
              annualDividendPerShareEur: null,
              estimatedAnnualIncomeEur: 0,
              exDividendDate: null,
              dividendDate: null,
              calendarPayoutDates: [],
              calendarPayoutSource: "none",
              payoutFrequency: null,
              error: true,
            };
          }
          try {
            const { divSym, sum, divList: pickedDivList, fundQuote, listQuote } = await resolveDividendBundle(
              yahooFinance,
              sym,
              h.displaySymbol
            );
            const divList = pickedDivList.length ? pickedDivList : [];
            const payoutFrequency = inferPayoutFrequencyFromChartDividends(divList);

            const sd = sum.summaryDetail as {
              trailingAnnualDividendRate?: number;
              dividendRate?: number;
              trailingAnnualDividendYield?: number;
              dividendYield?: number;
              exDividendDate?: unknown;
            } | undefined;
            const cal = sum.calendarEvents as { dividendDate?: unknown; exDividendDate?: unknown } | undefined;
            const price = sum.price as {
              longName?: string;
              shortName?: string;
              currency?: string;
              regularMarketPrice?: number;
            } | undefined;
            const dks = sum.defaultKeyStatistics as { financialCurrency?: string } | undefined;
            const sdRec = sd as Record<string, unknown> | undefined;
            const financialRaw =
              (typeof dks?.financialCurrency === "string" && dks.financialCurrency.trim()
                ? dks.financialCurrency.trim()
                : null) ??
              (sdRec && typeof sdRec.financialCurrency === "string" ? String(sdRec.financialCurrency).trim() : null);

            const listQ = listQuote && typeof listQuote === "object" ? (listQuote as { currency?: string; regularMarketPrice?: number }) : null;
            const fundQ = fundQuote && typeof fundQuote === "object" ? (fundQuote as { currency?: string }) : null;
            const listCurrency =
              typeof listQ?.currency === "string" && listQ.currency.trim() ? listQ.currency.trim() : "";
            const tradingCurrency = String(
              listCurrency || h.currency || price?.currency || "USD"
            ).toUpperCase();
            const dividendCurrency = String(
              financialRaw || (divSym !== sym ? fundQ?.currency || "USD" : tradingCurrency)
            ).toUpperCase();
            quoteCurrencies.add(tradingCurrency);
            quoteCurrencies.add(dividendCurrency);
            /** UI label for per-share dividend — matches `annualDividendPerShare` units. */
            const quoteCurrency = dividendCurrency;

            const perShareDirect =
              typeof sd?.trailingAnnualDividendRate === "number" &&
              Number.isFinite(sd.trailingAnnualDividendRate) &&
              sd.trailingAnnualDividendRate > 0
                ? sd.trailingAnnualDividendRate
                : typeof sd?.dividendRate === "number" && Number.isFinite(sd.dividendRate) && sd.dividendRate > 0
                  ? sd.dividendRate
                  : null;

            const listPx =
              typeof h.livePrice === "number" && h.livePrice > 0
                ? h.livePrice
                : typeof listQ?.regularMarketPrice === "number"
                  ? listQ.regularMarketPrice
                  : null;
            const livePx = listPx;
            let dividendYieldPercent = dividendYieldPercentFromQuoteSummary(sum);

            const yYield =
              sd?.trailingAnnualDividendYield ??
              sd?.dividendYield ??
              (perShareDirect != null && livePx ? perShareDirect / livePx : null);

            let annualPerShare = perShareDirect;
            if (
              (annualPerShare == null || !Number.isFinite(annualPerShare) || annualPerShare <= 0) &&
              livePx &&
              yYield != null &&
              typeof yYield === "number" &&
              Number.isFinite(yYield) &&
              yYield > 0
            ) {
              const frac = yYield > 0 && yYield <= 1 ? yYield : yYield / 100;
              annualPerShare = livePx * frac;
            }
            const chartAnnual = trailingAnnualDividendPerShareFromChart(divList);
            if (
              (annualPerShare == null || !Number.isFinite(annualPerShare) || annualPerShare <= 0) &&
              chartAnnual != null
            ) {
              annualPerShare = chartAnnual;
            }
            if (
              (dividendYieldPercent == null || dividendYieldPercent <= 0) &&
              annualPerShare != null &&
              annualPerShare > 0 &&
              livePx != null &&
              livePx > 0
            ) {
              dividendYieldPercent = Math.round((annualPerShare / livePx) * 10000) / 100;
            }

            const name = (price?.longName || price?.shortName || sym) as string;

            const dividendDate = toIsoDate(cal?.dividendDate);
            const exDividendDate = toIsoDate(cal?.exDividendDate ?? sd?.exDividendDate);
            const calSchedule = buildCalendarPayoutSchedule(
              dividendDate,
              exDividendDate,
              divList,
              payoutFrequency
            );

            return {
              symbol: sym,
              name,
              quantity: qty,
              quoteCurrency,
              tradingCurrency,
              dividendCurrency,
              yahooReferencePrice: livePx,
              dividendYieldPercent,
              annualDividendPerShare: annualPerShare != null && Number.isFinite(annualPerShare) ? annualPerShare : null,
              annualDividendPerShareEur: null,
              estimatedAnnualIncomeEur: 0,
              exDividendDate,
              dividendDate,
              calendarPayoutDates: calSchedule.dates,
              calendarPayoutSource: calSchedule.source,
              payoutFrequency,
              error: false,
            };
          } catch (e) {
            console.error(`[dividends] ${sym}`, e);
            const hc = (h.currency || "USD").toUpperCase();
            return {
              symbol: sym,
              name: sym,
              quantity: qty,
              quoteCurrency: hc,
              tradingCurrency: hc,
              dividendCurrency: hc,
              yahooReferencePrice: null,
              dividendYieldPercent: null,
              annualDividendPerShare: null,
              annualDividendPerShareEur: null,
              estimatedAnnualIncomeEur: 0,
              exDividendDate: null,
              dividendDate: null,
              calendarPayoutDates: [],
              calendarPayoutSource: "none",
              payoutFrequency: null,
              error: true,
            };
          }
        })
      );

      const neededRates = [...quoteCurrencies].filter((c) => c !== baseCurrency);
      await Promise.all(
        neededRates.map(async (curr) => {
          try {
            const q: { regularMarketPrice?: number } = await yahooFinance.quote(`${curr}${baseCurrency}=X`);
            if (q?.regularMarketPrice && Number.isFinite(q.regularMarketPrice)) rates[curr] = q.regularMarketPrice;
          } catch {
            if (curr === "USD" && !rates.USD) rates.USD = 0.92;
            if (curr === "GBP" && !rates.GBP) rates.GBP = 1.17;
            if (curr === "SEK" && !rates.SEK) rates.SEK = 0.088;
          }
        })
      );

      let totalAnnualIncomeEur = 0;
      let totalHoldingsValueEur = 0;

      holdings.forEach((h, i) => {
        const row = rows[i];
        if (!row || row.error) return;
        const divFx = rates[row.dividendCurrency] ?? (row.dividendCurrency === baseCurrency ? 1 : 0);
        const perShareEur =
          row.annualDividendPerShare != null && Number.isFinite(row.annualDividendPerShare) && divFx > 0
            ? row.annualDividendPerShare * divFx
            : null;
        row.annualDividendPerShareEur = perShareEur != null ? Math.round(perShareEur * 10000) / 10000 : null;
        const income = perShareEur != null && Number.isFinite(perShareEur) ? perShareEur * row.quantity : 0;
        row.estimatedAnnualIncomeEur = Math.round(income * 100) / 100;
        totalAnnualIncomeEur += row.estimatedAnnualIncomeEur;

        const holdCurr = (h.currency || baseCurrency).toUpperCase();
        const px =
          typeof h.livePrice === "number" && h.livePrice > 0
            ? h.livePrice
            : typeof h.averagePrice === "number"
              ? h.averagePrice
              : 0;
        const posRate = rates[holdCurr] ?? (holdCurr === baseCurrency ? 1 : 0);
        let positionValueEur =
          px > 0 && posRate > 0 && Number.isFinite(h.quantity) ? h.quantity * px * posRate : 0;
        if (!(positionValueEur > 0) && row.yahooReferencePrice != null && row.yahooReferencePrice > 0) {
          const tFx = rates[row.tradingCurrency] ?? (row.tradingCurrency === baseCurrency ? 1 : 0);
          if (tFx > 0 && Number.isFinite(h.quantity)) {
            positionValueEur = h.quantity * row.yahooReferencePrice * tFx;
          }
        }
        if (positionValueEur > 0) {
          totalHoldingsValueEur += positionValueEur;
          if (row.estimatedAnnualIncomeEur > 0) {
            row.dividendYieldPercent = Math.round((row.estimatedAnnualIncomeEur / positionValueEur) * 10000) / 100;
          }
          // Keep Yahoo/chart yield when income is still zero (e.g. FX pending).
        }
      });

      const averagePortfolioYieldPercent =
        totalHoldingsValueEur > 0 ? (totalAnnualIncomeEur / totalHoldingsValueEur) * 100 : 0;

      res.set("Cache-Control", "no-store");
      res.json({
        baseCurrency,
        rates,
        rows,
        totalAnnualIncomeEur: Math.round(totalAnnualIncomeEur * 100) / 100,
        totalHoldingsValueEur: Math.round(totalHoldingsValueEur * 100) / 100,
        averagePortfolioYieldPercent: Math.round(averagePortfolioYieldPercent * 100) / 100,
      });
    } catch (e) {
      console.error("[dividends]", e);
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: "Dividend fetch failed", detail: msg });
    }
  });
}
