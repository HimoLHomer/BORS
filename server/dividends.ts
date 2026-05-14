import type { Express, Request, Response } from "express";

export type DividendHoldingIn = {
  symbol: string;
  quantity: number;
  currency: string;
  livePrice?: number;
  averagePrice?: number;
};

function toIsoDate(d: unknown): string | null {
  if (d == null) return null;
  if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  if (typeof d === "string") {
    const t = Date.parse(d);
    if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
    return d.slice(0, 10);
  }
  if (typeof d === "number") {
    const ms = d > 1e12 ? d : d * 1000;
    const dt = new Date(ms);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  }
  return null;
}

/** Yahoo: yield often 0–1 as fraction; sometimes already a percent. */
export function normalizeYieldToPercent(raw: unknown): number | null {
  if (raw == null || typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return null;
  if (raw > 0 && raw <= 1) return raw * 100;
  if (raw > 1 && raw <= 100) return raw;
  return raw > 100 ? null : raw * 100;
}

/** Same yield source as `/api/portfolio/dividends` (summaryDetail + price), not `quote()`. */
export function dividendYieldPercentFromQuoteSummary(sum: {
  summaryDetail?: {
    dividendRate?: number;
    dividendYield?: number;
    trailingAnnualDividendRate?: number;
    trailingAnnualDividendYield?: number;
  };
  price?: { regularMarketPrice?: number };
}): number | null {
  const sd = sum.summaryDetail;
  const price = sum.price;
  const perShareDirect =
    typeof sd?.trailingAnnualDividendRate === "number" && Number.isFinite(sd.trailingAnnualDividendRate)
      ? sd.trailingAnnualDividendRate
      : typeof sd?.dividendRate === "number" && Number.isFinite(sd.dividendRate)
        ? sd.dividendRate
        : null;
  const livePx = typeof price?.regularMarketPrice === "number" ? price.regularMarketPrice : null;
  const yYield =
    sd?.trailingAnnualDividendYield ??
    sd?.dividendYield ??
    (perShareDirect != null && livePx ? perShareDirect / livePx : null);
  return normalizeYieldToPercent(yYield);
}

/** Yield from `quote()` when quoteSummary is empty (rare listings). */
export type InferredDividendPayoutFrequency = "monthly" | "quarterly" | "annual";

/** Infer pay cadence from Yahoo chart dividend events (median gap in days). */
export function inferPayoutFrequencyFromChartDividends(
  divs: { date?: Date | string; amount?: number }[] | undefined | null
): InferredDividendPayoutFrequency | null {
  if (!divs || divs.length < 2) return null;
  const times = divs
    .map((d) => new Date(d.date as Date).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (times.length < 2) return null;
  const gapsDays: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const gap = (times[i]! - times[i - 1]!) / (86400 * 1000);
    if (gap >= 18 && gap <= 400) gapsDays.push(gap);
  }
  if (gapsDays.length === 0) return null;
  gapsDays.sort((a, b) => a - b);
  const med = gapsDays[Math.floor(gapsDays.length / 2)]!;
  if (med < 50) return "monthly";
  if (med < 130) return "quarterly";
  return "annual";
}

/** Yield from `quote()` when quoteSummary is empty (rare listings). */
export function dividendYieldPercentFromQuote(detail: {
  trailingAnnualDividendYield?: number;
  dividendYield?: number;
  trailingAnnualDividendRate?: number;
  regularMarketPrice?: number;
}): number | null {
  const yYield =
    detail?.trailingAnnualDividendYield ??
    detail?.dividendYield ??
    (typeof detail?.trailingAnnualDividendRate === "number" &&
    Number.isFinite(detail.trailingAnnualDividendRate) &&
    typeof detail?.regularMarketPrice === "number" &&
    Number.isFinite(detail.regularMarketPrice) &&
    detail.regularMarketPrice > 0
      ? detail.trailingAnnualDividendRate / detail.regularMarketPrice
      : null);
  return normalizeYieldToPercent(yYield);
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
        quoteCurrency: string;
        dividendYieldPercent: number | null;
        annualDividendPerShare: number | null;
        annualDividendPerShareEur: number | null;
        estimatedAnnualIncomeEur: number;
        exDividendDate: string | null;
        dividendDate: string | null;
        payoutFrequency: InferredDividendPayoutFrequency | null;
        error: boolean;
      };

      const rows: RowOut[] = await Promise.all(
        holdings.map(async (h): Promise<RowOut> => {
          const qty = typeof h.quantity === "number" && Number.isFinite(h.quantity) ? h.quantity : 0;
          const sym = h.symbol?.trim();
          if (!sym) {
            return {
              symbol: "",
              name: "",
              quantity: qty,
              quoteCurrency: h.currency || baseCurrency,
              dividendYieldPercent: null,
              annualDividendPerShare: null,
              annualDividendPerShareEur: null,
              estimatedAnnualIncomeEur: 0,
              exDividendDate: null,
              dividendDate: null,
              payoutFrequency: null,
              error: true,
            };
          }
          try {
            const p2 = Math.floor(Date.now() / 1000);
            const p1 = p2 - 86400 * 800;
            const [sum, chartResult] = await Promise.all([
              yahooFinance.quoteSummary(
                sym,
                { modules: ["summaryDetail", "calendarEvents", "price"] },
                { validateResult: false }
              ),
              yahooFinance
                .chart(sym, { period1: p1, period2: p2, interval: "1d", events: "div" }, { validateResult: false })
                .catch(() => null),
            ]);
            const divList = chartResult?.events?.dividends as { date?: Date | string; amount?: number }[] | undefined;
            const payoutFrequency = inferPayoutFrequencyFromChartDividends(divList);

            const sd = sum.summaryDetail;
            const cal = sum.calendarEvents;
            const price = sum.price;
            const quoteCurrency = (price?.currency || h.currency || "USD").toUpperCase();
            quoteCurrencies.add(quoteCurrency);

            const perShareDirect =
              typeof sd?.trailingAnnualDividendRate === "number" && Number.isFinite(sd.trailingAnnualDividendRate)
                ? sd.trailingAnnualDividendRate
                : typeof sd?.dividendRate === "number" && Number.isFinite(sd.dividendRate)
                  ? sd.dividendRate
                  : null;

            const livePx = typeof price?.regularMarketPrice === "number" ? price.regularMarketPrice : null;
            const dividendYieldPercent = dividendYieldPercentFromQuoteSummary(sum);

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

            const name = (price?.longName || price?.shortName || sym) as string;

            return {
              symbol: sym,
              name,
              quantity: qty,
              quoteCurrency,
              dividendYieldPercent,
              annualDividendPerShare: annualPerShare != null && Number.isFinite(annualPerShare) ? annualPerShare : null,
              annualDividendPerShareEur: null,
              estimatedAnnualIncomeEur: 0,
              exDividendDate: toIsoDate(cal?.exDividendDate ?? sd?.exDividendDate),
              dividendDate: toIsoDate(cal?.dividendDate),
              payoutFrequency,
              error: false,
            };
          } catch (e) {
            console.error(`[dividends] ${sym}`, e);
            return {
              symbol: sym,
              name: sym,
              quantity: qty,
              quoteCurrency: (h.currency || "USD").toUpperCase(),
              dividendYieldPercent: null,
              annualDividendPerShare: null,
              annualDividendPerShareEur: null,
              estimatedAnnualIncomeEur: 0,
              exDividendDate: null,
              dividendDate: null,
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
        const fx = rates[row.quoteCurrency] ?? (row.quoteCurrency === baseCurrency ? 1 : 0);
        const perShareEur =
          row.annualDividendPerShare != null && Number.isFinite(row.annualDividendPerShare) && fx > 0
            ? row.annualDividendPerShare * fx
            : null;
        row.annualDividendPerShareEur = perShareEur != null ? Math.round(perShareEur * 10000) / 10000 : null;
        const income = perShareEur != null && Number.isFinite(perShareEur) ? perShareEur * row.quantity : 0;
        row.estimatedAnnualIncomeEur = Math.round(income * 100) / 100;
        totalAnnualIncomeEur += row.estimatedAnnualIncomeEur;

        const px =
          typeof h.livePrice === "number" && h.livePrice > 0
            ? h.livePrice
            : typeof h.averagePrice === "number"
              ? h.averagePrice
              : 0;
        const posRate = rates[h.currency] ?? (h.currency === baseCurrency ? 1 : 0);
        if (px > 0 && posRate > 0 && Number.isFinite(h.quantity)) {
          totalHoldingsValueEur += h.quantity * px * posRate;
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
