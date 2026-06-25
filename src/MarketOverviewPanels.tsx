import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { EMPTY_TOP_STORIES_USER_MESSAGE, sanitizeTopStoriesFallback, type MarketTopStory } from './marketTopStories';

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

function TopStoriesList({
  stories,
  fallbackText,
  searchEntryPointHtml,
}: {
  stories: MarketTopStory[];
  fallbackText: string;
  searchEntryPointHtml?: string | null;
}) {
  const safeFallback = sanitizeTopStoriesFallback(fallbackText);

  if (stories.length === 0) {
    const useMarkdown = /\*\*[^*]+\*\*/.test(safeFallback);
    return (
      <div className="text-text-p text-xs sm:text-sm leading-relaxed">
        {useMarkdown ? (
          <div className="markdown-body prose prose-sm prose-invert max-w-none">
            <Markdown>{safeFallback || 'Top stories unavailable.'}</Markdown>
          </div>
        ) : (
          <p className="m-0">{safeFallback || 'Top stories unavailable.'}</p>
        )}
      </div>
    );
  }

  return (
    <div className="market-top-stories space-y-3">
      <ul className="space-y-3 list-none m-0 p-0">
        {stories.map((story, i) => (
          <li key={`${story.headline}-${i}`} className="border-b border-border/30 pb-3 last:border-0 last:pb-0">
            {story.url ? (
              <a
                href={story.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs sm:text-sm text-text-p leading-snug hover:text-accent transition-colors line-clamp-3"
              >
                {story.headline}
              </a>
            ) : (
              <p className="text-xs sm:text-sm text-text-p leading-snug line-clamp-3">{story.headline}</p>
            )}
            <p className="text-[10px] text-text-s/70 mt-1 truncate">{story.source}</p>
          </li>
        ))}
      </ul>
      {searchEntryPointHtml ? (
        <details className="text-[10px] text-text-s/70">
          <summary className="cursor-pointer hover:text-text-s">Google Search suggestions</summary>
          <div
            className="mt-2 overflow-x-auto"
            dangerouslySetInnerHTML={{ __html: searchEntryPointHtml }}
          />
        </details>
      ) : null}
    </div>
  );
}

function useIndexTopStories(
  quote: MarketQuoteSnapshot | null | undefined,
  variant: 'us' | 'fi',
  asOf: string | null | undefined,
  heatmapAsOf: string | null | undefined,
  topMovers: TopMoversPayload | undefined,
  sectorBreadth: MarketSectorBreadth | undefined
) {
  const [stories, setStories] = useState<MarketTopStory[]>([]);
  const [fallbackText, setFallbackText] = useState('');
  const [searchEntryPointHtml, setSearchEntryPointHtml] = useState<string | null>(null);
  const [summaryDate, setSummaryDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);

  const price = quote?.price ?? null;
  const label = quote?.label ?? '';
  const currency = quote?.currency ?? 'USD';
  const changePercent = quote?.changePercent ?? 0;

  const marketDate = useMemo(() => todayIsoDateHelsinki(), []);

  const contextKey = useMemo(() => `${asOf ?? ''}|${heatmapAsOf ?? ''}|${marketDate}`, [asOf, heatmapAsOf, marketDate]);

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

  const fetchStories = useCallback(async (forceRefresh = false) => {
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
          stories?: MarketTopStory[];
          summary?: string;
          marketDate?: string;
          searchEntryPointHtml?: string;
          error?: string;
          code?: number;
        }>(res);
        if (!res.ok) {
          throw new Error(json.error ?? `Top stories failed (${res.status})`);
        }
        setSummaryDate(json.marketDate ?? marketDate);
        setStories(json.stories ?? []);
        setSearchEntryPointHtml(json.searchEntryPointHtml ?? null);
        setFallbackText(
          sanitizeTopStoriesFallback(json.summary?.trim() || '') ||
            (json.stories?.length ? '' : EMPTY_TOP_STORIES_USER_MESSAGE)
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'AI request failed';
        setStories([]);
        setSearchEntryPointHtml(null);
        setFallbackText(friendlyAiErrorMessage(msg));
      } finally {
        setLoading(false);
      }
  }, [aiConfigured, price, variant, label, changePercent, currency, marketDate, asOf, topMovers, sectorBreadth]);

  useEffect(() => {
    if (aiConfigured === false) {
      setStories([]);
      setSearchEntryPointHtml(null);
      setFallbackText('Add a **Gemini** API key under **Options → Market AI** for Top Stories.');
      setLoading(false);
      return;
    }
    if (aiConfigured !== true) return;
    if (price == null) {
      setStories([]);
      setFallbackText('Waiting for live quote…');
      setLoading(false);
      return;
    }
    void fetchStories();
  }, [aiConfigured, price, label, variant, marketDate, contextKey, fetchStories]);

  const canRefresh = aiConfigured === true && price != null;

  const refreshStories = useCallback(() => {
    if (!canRefresh) return;
    void fetchStories(true);
  }, [canRefresh, fetchStories]);

  return {
    stories,
    fallbackText,
    searchEntryPointHtml,
    summaryDate,
    loading,
    hasAiKey: aiConfigured === true,
    canRefresh,
    refreshStories,
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
}: {
  quote: MarketQuoteSnapshot | undefined;
  overviewLoading: boolean;
  variant: 'us' | 'fi';
  asOf?: string | null;
  /** Snapshot time of the heatmap tiles beside this panel (keeps AI in sync). */
  heatmapAsOf?: string | null;
  topMovers?: TopMoversPayload;
  sectorBreadth?: MarketSectorBreadth;
}) {
  const {
    stories,
    fallbackText,
    searchEntryPointHtml,
    summaryDate,
    loading: aiLoading,
    canRefresh,
    refreshStories,
  } = useIndexTopStories(quote, variant, asOf, heatmapAsOf, topMovers, sectorBreadth);

  return (
    <div className={`${MARKET_PANEL} flex flex-col flex-1 min-h-0 h-full`}>
      <div className="shrink-0 mb-2">
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

      <div className="flex flex-col flex-1 min-h-0 mt-3 pt-3 border-t border-border/40">
        <div className="flex items-center justify-between gap-2 mb-2 min-h-[1.25rem] shrink-0">
          <p className="text-[10px] font-bold text-text-s uppercase tracking-widest">
            Top stories
          </p>
          <div className="flex items-center gap-2 min-w-0">
            {summaryDate && !aiLoading ? (
              <p
                className="text-[10px] text-text-s/80 tabular-nums truncate"
                title="News date"
              >
                {formatDateFi(summaryDate)}
              </p>
            ) : null}
            {canRefresh ? (
              <button
                type="button"
                onClick={() => refreshStories()}
                disabled={aiLoading}
                title="Refresh top stories"
                aria-label="Refresh top stories"
                className="shrink-0 p-1 rounded-md text-text-s hover:text-text-p hover:bg-white/5 disabled:opacity-40 disabled:pointer-events-none transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${aiLoading ? 'animate-spin' : ''}`} />
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto pr-0.5">
        {aiLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-2.5 bg-white/5 rounded-full w-full animate-pulse" />
                <div className="h-2 bg-white/5 rounded-full w-1/4 animate-pulse" />
              </div>
            ))}
          </div>
        ) : (
          <TopStoriesList
            stories={stories}
            fallbackText={fallbackText}
            searchEntryPointHtml={searchEntryPointHtml}
          />
        )}
        </div>
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
