import type { Express, Request, Response } from "express";

export type DividendHoldingIn = {
  symbol: string;
  /** Dashboard ticker (e.g. O) when `symbol` is a local listing (e.g. RY6.F). */
  displaySymbol?: string | null;
  quantity: number;
  currency: string;
  livePrice?: number;
  averagePrice?: number;
};

/** Dividend fundamentals from primary ticker when holding is a foreign listing. */
export function yahooDividendSymbol(sym: string, displaySymbol?: string | null): string {
  const d = displaySymbol?.trim();
  if (!d) return sym;
  if (d.includes(".")) return sym;
  if (d.length > 8) return sym;
  if (d.toUpperCase() === sym.toUpperCase()) return sym;
  return d;
}

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

type CalendarPayoutSource = "yahoo" | "estimated" | "none";

function formatYmdUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addMonthsUtc(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
}

function addDaysUtc(d: Date, days: number): Date {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

function parseYmdUtc(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(Date.UTC(y, mo, day));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Days from ex-dividend to payment when Yahoo provides both calendar dates. */
export function inferExToPayLagDays(
  exDate: string | null,
  payDate: string | null
): number | null {
  const ex = exDate ? parseYmdUtc(exDate) : null;
  const pay = payDate ? parseYmdUtc(payDate) : null;
  if (!ex || !pay) return null;
  const lag = Math.round((pay.getTime() - ex.getTime()) / 86400000);
  if (lag >= 5 && lag <= 60) return lag;
  return null;
}

function defaultExToPayLagDays(freq: InferredDividendPayoutFrequency): number {
  if (freq === "monthly") return 28;
  if (freq === "quarterly") return 21;
  return 30;
}

function advanceAnchorToUpcomingUtc(anchor: Date, freq: InferredDividendPayoutFrequency): Date {
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let cur = new Date(anchor.getTime());
  const step = freq === "monthly" ? 1 : freq === "quarterly" ? 3 : 12;
  let guard = 0;
  while (cur.getTime() < todayUtc && guard < 600) {
    cur = addMonthsUtc(cur, step);
    guard += 1;
  }
  return cur;
}

function scheduleCount(freq: InferredDividendPayoutFrequency): number {
  if (freq === "monthly") return 18;
  if (freq === "quarterly") return 12;
  return 6;
}

/** Project pay dates forward from a known payment anchor (Yahoo pay date or manual anchor). */
function projectedPayoutDatesFromAnchor(
  payAnchorYmd: string,
  freq: InferredDividendPayoutFrequency,
  count: number
): string[] {
  const parsed = parseYmdUtc(payAnchorYmd);
  if (!parsed) return [];
  const step = freq === "monthly" ? 1 : freq === "quarterly" ? 3 : 12;
  let cur = advanceAnchorToUpcomingUtc(parsed, freq);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(formatYmdUtc(cur));
    cur = addMonthsUtc(cur, step);
  }
  return out;
}

/**
 * Yahoo chart `events.dividends` are ex-dividend dates, not payment dates.
 * Shift the last ex-date by a typical ex→pay lag, then project forward.
 */
function projectedPayoutDatesFromChartDividends(
  divList: { date?: Date | string }[] | undefined,
  freq: InferredDividendPayoutFrequency | null,
  exToPayLagDays: number,
  count: number
): string[] {
  if (!freq || !divList?.length) return [];
  const times = divList
    .map((d) => new Date(d.date as Date).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (times.length === 0) return [];
  const lastEx = new Date(times[times.length - 1]!);
  const lastExUtc = new Date(Date.UTC(lastEx.getUTCFullYear(), lastEx.getUTCMonth(), lastEx.getUTCDate()));
  const payAnchor = addDaysUtc(lastExUtc, exToPayLagDays);
  return projectedPayoutDatesFromAnchor(formatYmdUtc(payAnchor), freq, count);
}

function buildCalendarPayoutSchedule(
  officialPay: string | null,
  officialEx: string | null,
  divList: { date?: Date | string }[] | undefined,
  freq: InferredDividendPayoutFrequency | null
): { dates: string[]; source: CalendarPayoutSource } {
  const effectiveFreq =
    freq ?? (divList && divList.length >= 2 ? inferPayoutFrequencyFromChartDividends(divList) : null);
  const lag =
    inferExToPayLagDays(officialEx, officialPay) ??
    (effectiveFreq ? defaultExToPayLagDays(effectiveFreq) : null);

  if (officialPay && effectiveFreq) {
    return {
      dates: projectedPayoutDatesFromAnchor(officialPay, effectiveFreq, scheduleCount(effectiveFreq)),
      source: "yahoo",
    };
  }

  if (officialPay) {
    return { dates: [officialPay], source: "yahoo" };
  }

  if (effectiveFreq && lag != null) {
    const est = projectedPayoutDatesFromChartDividends(divList, effectiveFreq, lag, 14);
    if (est.length) return { dates: est, source: "estimated" };
  }

  return { dates: [], source: "none" };
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
            const divSym = yahooDividendSymbol(sym, h.displaySymbol);
            const p2 = Math.floor(Date.now() / 1000);
            const p1 = p2 - 86400 * 800;
            const [sum, chartResult, listQuote, fundQuote] = await Promise.all([
              yahooFinance.quoteSummary(
                divSym,
                { modules: ["summaryDetail", "calendarEvents", "price", "defaultKeyStatistics"] },
                { validateResult: false }
              ),
              yahooFinance
                .chart(divSym, { period1: p1, period2: p2, interval: "1d", events: "div" }, { validateResult: false })
                .catch(() => null),
              yahooFinance.quote(sym).catch(() => null),
              divSym !== sym ? yahooFinance.quote(divSym).catch(() => null) : Promise.resolve(null),
            ]);
            const fastQuote = listQuote ?? fundQuote;
            const divList = chartResult?.events?.dividends as { date?: Date | string; amount?: number }[] | undefined;
            const payoutFrequency = inferPayoutFrequencyFromChartDividends(divList);

            const sd = sum.summaryDetail;
            const cal = sum.calendarEvents;
            const price = sum.price;
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
              typeof sd?.trailingAnnualDividendRate === "number" && Number.isFinite(sd.trailingAnnualDividendRate)
                ? sd.trailingAnnualDividendRate
                : typeof sd?.dividendRate === "number" && Number.isFinite(sd.dividendRate)
                  ? sd.dividendRate
                  : null;

            const listPx =
              typeof h.livePrice === "number" && h.livePrice > 0
                ? h.livePrice
                : typeof listQ?.regularMarketPrice === "number"
                  ? listQ.regularMarketPrice
                  : null;
            const livePx = listPx;
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
          } else {
            row.dividendYieldPercent = null;
          }
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
