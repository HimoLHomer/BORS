import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { formatNumberFi, formatPercentFi } from './formatNumber';
import { formatCurrency } from './formatCurrency';
import { fetchJson } from './apiFetch';
import { onFeedReconnected } from './feedReconnect';
import { MARKET_PANEL, MARKET_SUBCARD } from './marketTheme';
import { formatDateFi, todayIsoDateHelsinki } from './formatDate';
import type { MarketHeatmapMover, MarketSectorBreadth } from './marketHeatmapUtils';
import {
  EMPTY_TOP_STORIES_USER_MESSAGE,
  formatStoryReferenceLabel,
  sanitizeTopStories,
  storyReferencesForDisplay,
  type MarketTopStory,
} from './marketTopStories';

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

function TopStorySourcePill({ ref: storyRef }: { ref: { title: string; url?: string } }) {
  const label = storyRef.title.trim() || formatStoryReferenceLabel(storyRef);
  const pillClass =
    'inline-flex max-w-full items-center rounded border border-border/30 bg-white/5 px-1.5 py-px font-sans text-[10px] font-medium leading-tight text-accent transition-colors';

  if (storyRef.url) {
    return (
      <a
        href={storyRef.url}
        target="_blank"
        rel="noopener noreferrer"
        title={storyRef.url}
        className={`${pillClass} hover:border-accent/30 hover:text-accent`}
      >
        <span className="truncate">{label}</span>
      </a>
    );
  }

  return (
    <span className={pillClass}>
      <span className="truncate">{label}</span>
    </span>
  );
}

function TopStoryCardSkeleton() {
  return (
    <li className="shrink-0">
      <div className={`${MARKET_SUBCARD} px-2.5 py-2 flex flex-col`}>
        <div className="h-2 bg-white/5 rounded-full w-full animate-pulse" />
        <div className="h-2 bg-white/5 rounded-full w-[85%] animate-pulse shrink-0" />
        <div className="mt-1.5 h-3.5 w-16 rounded bg-white/5 animate-pulse shrink-0" />
      </div>
    </li>
  );
}

function TopStoriesList({
  stories,
  fallbackText,
}: {
  stories: MarketTopStory[];
  fallbackText: string;
}) {
  if (stories.length === 0) {
    return (
      <div className={`${MARKET_SUBCARD} p-2 font-sans`}>
        <p className="m-0 text-xs text-text-s/80 leading-snug">
          {fallbackText || 'Top stories unavailable.'}
        </p>
      </div>
    );
  }

  const cleaned = sanitizeTopStories(stories);

  const renderStory = (story: MarketTopStory, i: number) => {
    const references = storyReferencesForDisplay(story);
    const primaryRef = references[0];

    return (
      <li key={`${story.headline}-${i}`}>
        <article
          className={`${MARKET_SUBCARD} font-sans hover:bg-bg/40 transition-colors`}
        >
          <p className="text-xs font-semibold text-text-p leading-snug line-clamp-2 m-0 min-h-0 overflow-hidden">
            {story.headline}
          </p>
          {primaryRef ? (
            <div className="market-top-story-source">
              <TopStorySourcePill ref={primaryRef} />
            </div>
          ) : null}
        </article>
      </li>
    );
  };

  return (
    <div className="market-top-stories">
      <ul>
        {cleaned.map((story, i) => renderStory(story, i))}
      </ul>
    </div>
  );
}

function useIndexNews(
  quote: MarketQuoteSnapshot | null | undefined,
  variant: 'us' | 'fi',
  topMovers: TopMoversPayload | undefined,
  sectorBreadth: MarketSectorBreadth | undefined
) {
  const [stories, setStories] = useState<MarketTopStory[]>([]);
  const [fallbackText, setFallbackText] = useState('');
  const [summaryDate, setSummaryDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const price = quote?.price ?? null;
  const changePercent = quote?.changePercent ?? 0;

  const initialFetchDoneRef = useRef(false);

  const fetchStories = useCallback(async (forceRefresh = false) => {
    if (price == null) return;
    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        variant,
        changePercent,
        marketDate: todayIsoDateHelsinki(),
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
      const res = await fetch('/api/market/news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await fetchJson<{
        stories?: MarketTopStory[];
        marketDate?: string;
        error?: string;
      }>(res);
      if (!res.ok) {
        throw new Error(json.error ?? `Top stories failed (${res.status})`);
      }
      setSummaryDate(json.marketDate ?? todayIsoDateHelsinki());
      setStories(sanitizeTopStories(json.stories ?? []));
      setFallbackText(json.stories?.length ? '' : EMPTY_TOP_STORIES_USER_MESSAGE);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not load news';
      setStories([]);
      setFallbackText(msg);
    } finally {
      setLoading(false);
    }
  }, [price, variant, changePercent, topMovers, sectorBreadth]);

  const fetchStoriesRef = useRef(fetchStories);
  fetchStoriesRef.current = fetchStories;

  useEffect(() => {
    if (price == null) {
      setStories([]);
      setFallbackText('Waiting for live quote…');
      setLoading(false);
      return;
    }
    if (initialFetchDoneRef.current) return;
    initialFetchDoneRef.current = true;
    void fetchStoriesRef.current();
  }, [price]);

  const canRefresh = price != null;

  const refreshStories = useCallback(() => {
    if (!canRefresh) return;
    void fetchStories(true);
  }, [canRefresh, fetchStories]);

  return {
    stories,
    fallbackText,
    summaryDate,
    loading,
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
  topMovers,
  sectorBreadth,
  className = '',
}: {
  quote: MarketQuoteSnapshot | undefined;
  overviewLoading: boolean;
  variant: 'us' | 'fi';
  topMovers?: TopMoversPayload;
  sectorBreadth?: MarketSectorBreadth;
  className?: string;
}) {
  const {
    stories,
    fallbackText,
    summaryDate,
    loading: newsLoading,
    canRefresh,
    refreshStories,
  } = useIndexNews(quote, variant, topMovers, sectorBreadth);

  const showActiveFetch = newsLoading && quote?.price != null;
  const storiesFallback = fallbackText;

  return (
    <div
      className={`${MARKET_PANEL} market-index-panel flex flex-col h-full min-h-0 overflow-hidden ${className}`}
    >
      <div className="shrink-0 mb-1">
        <h3 className="card-title mb-0">{quote?.label ?? '—'}</h3>
        {overviewLoading && !quote ? (
          <div className="h-7 w-28 bg-white/5 rounded animate-pulse mt-1.5" />
        ) : (
          <>
            <p className="stat-value text-2xl sm:text-3xl font-black tracking-tighter tabular-nums mt-1.5">
              {quote ? formatQuotePrice(quote) : '—'}
              {quote?.kind === 'index' && quote.price != null && (
                <span className="text-xs font-semibold text-text-s ml-1.5 font-sans">{quote.currency}</span>
              )}
            </p>
            {quote && <QuoteChangeLine quote={quote} />}
          </>
        )}
      </div>

      <div className="flex flex-col flex-1 min-h-0 mt-2 pt-2 border-t border-border/40">
        <div className="flex items-center justify-between gap-2 mb-1 min-h-[1.125rem] shrink-0">
          <p className="micro-label mb-0">
            Top stories
          </p>
          <div className="flex items-center gap-2 min-w-0">
            {summaryDate && !newsLoading ? (
              <p
                className="font-sans text-[10px] text-text-s/80 tabular-nums truncate"
                title="News date"
              >
                {formatDateFi(summaryDate)}
              </p>
            ) : null}
            {canRefresh ? (
              <button
                type="button"
                onClick={() => refreshStories()}
                disabled={newsLoading}
                title="Refresh top stories"
                aria-label="Refresh top stories"
                className="shrink-0 p-1 rounded-md text-text-s hover:text-text-p hover:bg-white/5 disabled:opacity-40 disabled:pointer-events-none transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${newsLoading ? 'animate-spin' : ''}`} />
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col">
        {showActiveFetch ? (
          <div className="market-top-stories">
            <ul>
              {Array.from({ length: 3 }).map((_, i) => (
                <TopStoryCardSkeleton key={i} />
              ))}
            </ul>
          </div>
        ) : (
          <TopStoriesList
            stories={stories}
            fallbackText={storiesFallback}
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
    <div className={`${MARKET_PANEL} min-h-[180px]`}>
      <h3 className="card-title mb-0">Alternative investments</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 mt-3">
        {order.map((id) => (
          <AlternativeAssetCard key={id} quote={byId.get(id)} loading={loading} />
        ))}
      </div>
    </div>
  );
}
