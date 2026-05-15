import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import { formatNumberFi, formatPercentFi } from './formatNumber';
import { formatCurrency } from './formatCurrency';
import { fetchJson } from './apiFetch';
import { friendlyAiErrorMessage } from './aiErrorMessage';
import { MARKET_PANEL, MARKET_SUBCARD } from './marketTheme';

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

  return { overview, loading, error, reload: () => load(true) };
}

function useIndexAiSummary(
  quote: MarketQuoteSnapshot | null | undefined,
  variant: 'us' | 'fi'
) {
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(true);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);

  const price = quote?.price ?? null;
  const changePercent = quote?.changePercent ?? 0;
  const label = quote?.label ?? '';
  const currency = quote?.currency ?? 'USD';

  useEffect(() => {
    void fetch('/api/market/ai-status', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { configured?: boolean }) => setAiConfigured(Boolean(j.configured)))
      .catch(() => setAiConfigured(false));
  }, []);

  useEffect(() => {
    if (aiConfigured === false) {
      setSummary('Add **GEMINI_API_KEY** to `.env.local` and restart `npm run dev`.');
      setLoading(false);
      return;
    }
    if (aiConfigured !== true) return;
    if (price == null) {
      setSummary('Waiting for live quote…');
      setLoading(false);
      return;
    }

    const run = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/market/ai-summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variant, label, price, changePercent, currency }),
        });
        const json = await fetchJson<{ summary?: string; error?: string; code?: number }>(res);
        if (!res.ok) {
          throw new Error(json.error ?? `AI summary failed (${res.status})`);
        }
        setSummary(json.summary?.trim() || 'Summary unavailable — try refreshing.');
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'AI request failed';
        setSummary(friendlyAiErrorMessage(msg));
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [aiConfigured, price, changePercent, label, currency, variant]);

  return { summary, loading, hasGeminiKey: aiConfigured === true };
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
  panelMinHeight,
  aiMinHeight = 'min-h-[220px]',
}: {
  quote: MarketQuoteSnapshot | undefined;
  overviewLoading: boolean;
  variant: 'us' | 'fi';
  panelMinHeight?: string;
  aiMinHeight?: string;
}) {
  const { summary, loading: aiLoading } = useIndexAiSummary(quote, variant);

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
        {aiLoading ? (
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
