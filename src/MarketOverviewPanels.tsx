import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import Markdown from 'react-markdown';
import { formatNumberFi, formatPercentFi } from './formatNumber';
import { formatCurrency } from './formatCurrency';
import { fetchJson } from './apiFetch';
import { onFeedReconnected } from './feedReconnect';
import { friendlyAiErrorMessage } from './aiErrorMessage';
import { MARKET_PANEL, MARKET_SUBCARD } from './marketTheme';
import { formatDateFi, todayIsoDateHelsinki } from './formatDate';
import type { MarketHeatmapMover, MarketSectorBreadth } from './marketAiPrompt';
import { sanitizeMarketSummary } from './marketAiValidation';
import { getMarketSessionStatus, useMarketSessionClock } from './marketSession';

export type MarketQuoteSnapshot = {
  id: string;
  label: string;
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number;
  currency: string;
  kind: 'index' | 'alternative';
};

export type MarketOverviewResponse = {
  asOf: string;
  cached: boolean;
  sp500: MarketQuoteSnapshot;
  omxhpi: MarketQuoteSnapshot;
  alternatives: MarketQuoteSnapshot[];
};

function changeColorClass(pct: number): string {
  if (!Number.isFinite(pct) || Math.abs(pct) < 0.001) return 'text-text-s';
  return pct > 0 ? '!text-green' : '!text-red';
}

export function formatQuotePrice(q: MarketQuoteSnapshot): string {
  if (q.price == null || !Number.isFinite(q.price)) return '—';
  if (q.kind === 'index') {
    return formatNumberFi(q.price, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (q.id === 'usdeur') {
    return formatNumberFi(q.price, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (q.id === 'btc') {
    return formatCurrency(q.price, 'USD');
  }
  return formatCurrency(q.price, q.currency);
}

export function useMarketOverview() {
  const [overview, setOverview] = useState<MarketOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/market/overview${refresh ? '?refresh=1' : ''}`,
        { cache: 'no-store' }
      );
      const json = await fetchJson<MarketOverviewResponse & { error?: string }>(res);
      if (!res.ok) throw new Error(json.error ?? 'Market overview failed');
      setOverview(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Market overview failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => onFeedReconnected(() => void load(true)), [load]);

  return { overview, loading, error, reload: () => load(true) };
}

type TopMoversPayload = {
  gainers: MarketHeatmapMover[];
  losers: MarketHeatmapMover[];
};

function useIndexAiSummary(
  quote: MarketQuoteSnapshot | null | undefined,
  variant: 'us' | 'fi',
  asOf: string | null | undefined,
  heatmapAsOf: string | null | undefined,
  topMovers: TopMoversPayload | undefined,
  sectorBreadth: MarketSectorBreadth | undefined
) {
  const [summary, setSummary] = useState('');
  const [summaryDate, setSummaryDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const summaryTextRef = useRef('');
  const postCloseHydrateRef = useRef(false);

  const price = quote?.price ?? null;
  const label = quote?.label ?? '';
  const currency = quote?.currency ?? 'USD';
  const changePercent = quote?.changePercent ?? 0;

  const marketDate = useMemo(() => todayIsoDateHelsinki(), []);
  const sessionTick = useMarketSessionClock();
  const session = useMemo(
    () => getMarketSessionStatus(variant, new Date(sessionTick)),
    [variant, sessionTick]
  );

  const contextKey = useMemo(() => {
    const g = topMovers?.gainers ?? [];
    const l = topMovers?.losers ?? [];
    const movers = [...g, ...l].map((m) => `${m.symbol}:${m.changePercent.toFixed(2)}`).join('|');
    const sector = sectorBreadth
      ? `${sectorBreadth.leadingSector}:${sectorBreadth.leadingAvgPct.toFixed(2)}`
      : '';
    const idx = Number.isFinite(changePercent) ? changePercent.toFixed(2) : '0';
    return `${asOf ?? ''}|${heatmapAsOf ?? ''}|${idx}|${movers}|${sector}`;
  }, [topMovers, sectorBreadth, changePercent, asOf, heatmapAsOf]);

  const refreshAiStatus = useCallback(() => {
    void fetch('/api/market/ai-status', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { configured?: boolean }) => setAiConfigured(Boolean(j.configured)))
      .catch(() => setAiConfigured(false));
  }, []);

  useEffect(() => {
    refreshAiStatus();
    const onSettings = () => refreshAiStatus();
    window.addEventListener('bors-ai-settings-changed', onSettings);
    return () => window.removeEventListener('bors-ai-settings-changed', onSettings);
  }, [refreshAiStatus]);

  const fetchSummary = useCallback(async (forceRefresh = false) => {
      if (aiConfigured !== true || price == null) return;
      setLoading(true);
      try {
        const body: Record<string, unknown> = {
          variant,
          label,
          price,
          changePercent,
          currency,
          marketDate,
          asOf: asOf ?? null,
          refresh: forceRefresh,
        };
        const g = topMovers?.gainers ?? [];
        const l = topMovers?.losers ?? [];
        if (g.length > 0 || l.length > 0) {
          body.topMovers = { gainers: g, losers: l };
        }
        if (sectorBreadth) {
          body.sectorBreadth = sectorBreadth;
        }
        const res = await fetch('/api/market/ai-summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await fetchJson<{
          summary?: string;
          marketDate?: string;
          error?: string;
          code?: number;
        }>(res);
        if (!res.ok) {
          throw new Error(json.error ?? `AI summary failed (${res.status})`);
        }
        setSummaryDate(json.marketDate ?? marketDate);
        const raw = json.summary?.trim() || 'Summary unavailable.';
        setSummary(raw);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'AI request failed';
        setSummary(friendlyAiErrorMessage(msg));
      } finally {
        setLoading(false);
      }
  }, [aiConfigured, price, variant, label, changePercent, currency, marketDate, asOf, topMovers, sectorBreadth]);

  useEffect(() => {
    summaryTextRef.current = summary;
  }, [summary]);

  useEffect(() => {
    if (!session.showSummary) {
      postCloseHydrateRef.current = false;
      setSummary(session.closedMessage);
      setSummaryDate(null);
      setLoading(false);
      return;
    }
    if (!session.isOpen) {
      setLoading(false);
      const hasMovers =
        (topMovers?.gainers.length ?? 0) > 0 || (topMovers?.losers.length ?? 0) > 0;
      if (
        !postCloseHydrateRef.current &&
        !summaryTextRef.current.trim() &&
        aiConfigured === true &&
        price != null &&
        hasMovers
      ) {
        postCloseHydrateRef.current = true;
        void fetchSummary();
      }
      return;
    }
    postCloseHydrateRef.current = false;
    if (aiConfigured === false) {
      setSummary('Add an API key under **Options → Market AI** for your chosen provider (Gemini or OpenAI).');
      setLoading(false);
      return;
    }
    if (aiConfigured !== true) return;
    if (price == null) {
      setSummary('Waiting for live quote…');
      setLoading(false);
      return;
    }
    const hasMovers =
      (topMovers?.gainers.length ?? 0) > 0 || (topMovers?.losers.length ?? 0) > 0;
    if (!hasMovers) return;
    void fetchSummary();
  }, [
    aiConfigured,
    price,
    label,
    variant,
    marketDate,
    contextKey,
    fetchSummary,
    session.isOpen,
    session.showSummary,
    session.closedMessage,
  ]);

  const displaySummary = useMemo(() => {
    if (!session.showSummary) return summary;
    if (!summary.trim() || price == null) return summary;
    const g = topMovers?.gainers ?? [];
    const l = topMovers?.losers ?? [];
    const movers = [...g, ...l].map((m) => ({
      symbol: m.symbol,
      name: m.name,
      changePercent: m.changePercent,
    }));
    return sanitizeMarketSummary(summary, {
      indexLabel: label,
      changePercent,
      movers,
      topGainer: g[0]
        ? { symbol: g[0].symbol, name: g[0].name, changePercent: g[0].changePercent }
        : undefined,
      topLoser: l[0]
        ? { symbol: l[0].symbol, name: l[0].name, changePercent: l[0].changePercent }
        : undefined,
    });
  }, [summary, price, label, changePercent, topMovers, session.showSummary]);

  const canRefresh =
    session.showSummary &&
    aiConfigured === true &&
    price != null &&
    ((topMovers?.gainers.length ?? 0) > 0 || (topMovers?.losers.length ?? 0) > 0);

  const refreshSummary = useCallback(() => {
    if (!canRefresh) return;
    void fetchSummary(true);
  }, [canRefresh, fetchSummary]);

  return {
    summary: displaySummary,
    summaryDate: session.showSummary ? summaryDate : null,
    loading: session.showSummary ? loading : false,
    hasAiKey: aiConfigured === true,
    marketClosed: !session.showSummary,
    canRefresh,
    refreshSummary,
  };
}

function QuoteChangeLine({ quote }: { quote: MarketQuoteSnapshot }) {
  const pct = quote.changePercent;
  const color = changeColorClass(pct);
  return (
    <p className={`text-sm font-bold tabular-nums ${color}`}>
      {formatPercentFi(pct, 2, { showPlus: true })}
      {quote.change != null && Number.isFinite(quote.change) && (
        <span className={`font-semibold text-xs ml-2 opacity-90 ${color}`}>
          ({quote.change >= 0 ? '+' : ''}
          {formatNumberFi(quote.change, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
        </span>
      )}
    </p>
  );
}

export function MarketIndexPanel({
  quote,
  overviewLoading,
  variant,
  asOf,
  heatmapAsOf,
  topMovers,
  sectorBreadth,
  panelMinHeight,
  aiMinHeight = 'min-h-[220px]',
}: {
  quote: MarketQuoteSnapshot | undefined;
  overviewLoading: boolean;
  variant: 'us' | 'fi';
  asOf?: string | null;
  /** Snapshot time of the heatmap tiles beside this panel (keeps AI in sync). */
  heatmapAsOf?: string | null;
  topMovers?: TopMoversPayload;
  sectorBreadth?: MarketSectorBreadth;
  panelMinHeight?: string;
  aiMinHeight?: string;
}) {
  const {
    summary,
    summaryDate,
    loading: aiLoading,
    marketClosed,
    canRefresh,
    refreshSummary,
  } = useIndexAiSummary(quote, variant, asOf, heatmapAsOf, topMovers, sectorBreadth);

  return (
    <div className={`${MARKET_PANEL} flex flex-col flex-1 min-h-0 ${panelMinHeight ?? ''}`}>
      <div className="mb-2">
        <h3 className="card-title mb-0">{quote?.label ?? '—'}</h3>
        {overviewLoading && !quote ? (
          <div className="h-8 w-32 bg-white/5 rounded animate-pulse mt-2" />
        ) : (
          <>
            <p className="stat-value text-3xl sm:text-4xl font-black tracking-tighter tabular-nums mt-2">
              {quote ? formatQuotePrice(quote) : '—'}
              {quote?.kind === 'index' && quote.price != null && (
                <span className="text-xs font-semibold text-text-s ml-1.5 font-sans">{quote.currency}</span>
              )}
            </p>
            {quote && <QuoteChangeLine quote={quote} />}
          </>
        )}
      </div>

      <div className={`flex-1 min-h-0 overflow-y-auto scrollbar-hidden mt-3 pt-3 border-t border-border/40 ${aiMinHeight}`}>
        {!marketClosed && (summaryDate || canRefresh) && (
          <div className="flex items-center justify-between gap-2 mb-2 min-h-[1.25rem]">
            {summaryDate && !aiLoading ? (
              <p
                className="text-[10px] text-text-s/80 tabular-nums"
                title="News date used for this summary"
              >
                News for {formatDateFi(summaryDate)}
              </p>
            ) : (
              <span className="flex-1" />
            )}
            {canRefresh && (
              <button
                type="button"
                onClick={() => refreshSummary()}
                disabled={aiLoading}
                title="Refresh AI summary"
                aria-label="Refresh AI summary"
                className="shrink-0 p-1 rounded-md text-text-s hover:text-text-p hover:bg-white/5 disabled:opacity-40 disabled:pointer-events-none transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${aiLoading ? 'animate-spin' : ''}`} />
              </button>
            )}
          </div>
        )}
        {aiLoading && !marketClosed ? (
          <div className="space-y-2">
            <div className="h-2.5 bg-white/5 rounded-full w-full animate-pulse" />
            <div className="h-2.5 bg-white/5 rounded-full w-5/6 animate-pulse" />
            <div className="h-2.5 bg-white/5 rounded-full w-4/6 animate-pulse" />
          </div>
        ) : (
          <div className="markdown-body text-text-p text-xs sm:text-sm leading-relaxed prose prose-sm prose-invert max-w-none prose-ul:my-1 prose-li:my-0.5">
            <Markdown>{summary}</Markdown>
          </div>
        )}
      </div>
    </div>
  );
}

function AlternativeAssetCard({
  quote,
  loading,
}: {
  quote: MarketQuoteSnapshot | undefined;
  loading: boolean;
}) {
  return (
    <div className={`${MARKET_SUBCARD} p-4 flex flex-col gap-1 min-h-[88px]`}>
      <p className="card-title mb-0">{quote?.label ?? '—'}</p>
      {loading && !quote ? (
        <div className="h-6 w-20 bg-white/5 rounded animate-pulse mt-1" />
      ) : (
        <>
          <p className="stat-value text-xl font-black tracking-tight tabular-nums mt-1">
            {quote ? formatQuotePrice(quote) : '—'}
          </p>
          {quote && (
            <p className={`text-xs font-bold tabular-nums ${changeColorClass(quote.changePercent)}`}>
              {formatPercentFi(quote.changePercent, 2, { showPlus: true })}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function AlternativeInvestmentsPanel({
  alternatives,
  loading,
}: {
  alternatives: MarketQuoteSnapshot[];
  loading: boolean;
}) {
  const byId = useMemo(() => new Map(alternatives.map((a) => [a.id, a])), [alternatives]);
  const order = ['btc', 'gold', 'silver', 'oil', 'usdeur'] as const;

  return (
    <div className={MARKET_PANEL}>
      <h3 className="card-title mb-4">Alternative investments</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        {order.map((id) => (
          <AlternativeAssetCard key={id} quote={byId.get(id)} loading={loading} />
        ))}
      </div>
    </div>
  );
}
