import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { formatCurrency } from './formatCurrency';
import { formatDateFi, formatMonthYearFi, formatShortMonthDayEn } from './formatDate';
import { IssuerLogo } from './AssetNameCell';
import { MARKET_SUBCARD } from './marketTheme';
import {
  type ApiDividendPaymentInput,
  type ManualDividendPaymentInput,
  type RedeemedDividendPayment,
  type ScheduledDividendPayment,
  buildProjectedPayments,
  groupRedeemedByMonth,
  groupScheduledByMonth,
  loadRedeemed,
  redeemPayment,
  saveRedeemed,
  unredeemPayment,
  REDEEMED_DIVIDENDS_CHANGED_EVENT,
} from './dividendRedemptions';
import { formatRedeemAnnouncement, playRedeemChime } from './redeemDividendFeedback';
import { SkeletonDividendCalendar } from './SkeletonPulse';
import { loadFireInputs, FIRE_INPUTS_CHANGED_EVENT } from './fireStorage';

type TileSize = 'featured' | 'cluster' | 'compact';

const DIVIDEND_MONTH_NAV_PILL =
  'inline-flex items-center rounded-lg border border-border/50 bg-white/[0.04] p-0.5 shrink-0';
const DIVIDEND_MONTH_NAV_BTN =
  'h-7 w-7 rounded-md flex items-center justify-center shrink-0 text-text-s hover:text-accent hover:bg-accent/10 transition-colors disabled:opacity-30 disabled:pointer-events-none disabled:hover:bg-transparent';
const DIVIDEND_MONTH_NAV_LABEL =
  'text-[10px] font-bold uppercase tracking-widest text-text-p px-2 min-w-[5.5rem] text-center truncate';

const TILE_PRESETS = {
  featured: {
    logoPx: 80,
    amountClass: 'text-sm',
    metaClass: 'text-[10px]',
    stackGap: 'gap-2.5',
    textGap: 'gap-0.5',
    pad: 'p-2.5',
  },
  cluster: {
    logoPx: 34,
    amountClass: 'text-[11px]',
    metaClass: 'text-[9px]',
    stackGap: 'gap-1.5',
    textGap: 'gap-px',
    pad: 'p-1.5',
  },
  compact: {
    logoPx: 22,
    amountClass: 'text-[11px]',
    metaClass: 'text-[8px]',
    stackGap: 'gap-1',
    textGap: 'gap-0',
    pad: 'py-1 px-1.5',
  },
} as const;

function sortByPayDateAsc(payments: ScheduledDividendPayment[]): ScheduledDividendPayment[] {
  return [...payments].sort((a, b) => {
    const da = a.payDateYmd ?? '9999-12-31';
    const db = b.payDateYmd ?? '9999-12-31';
    if (da !== db) return da.localeCompare(db);
    return a.name.localeCompare(b.name);
  });
}

function historyTileRowClass(): string {
  return 'dividend-payout-row flex shrink-0 items-stretch gap-2 overflow-x-auto overflow-y-hidden flex-nowrap list-none m-0 p-0 pb-0.5 h-[3.25rem] [&>li]:shrink-0 [&>li]:h-full [&>li]:w-[6.25rem]';
}

function DividendPayoutCard({
  name,
  ticker,
  metaLine,
  amountEur,
  onClick,
  ariaLabel,
  actionHint,
  hoverLabel,
  tileSize = 'featured',
  className = '',
}: {
  name: string;
  ticker: string;
  metaLine?: string;
  amountEur: number;
  onClick?: () => void;
  ariaLabel?: string;
  actionHint?: string;
  hoverLabel?: string;
  tileSize?: TileSize;
  className?: string;
}) {
  const preset = TILE_PRESETS[tileSize];
  const interactive = onClick != null;
  const Tag = interactive ? 'button' : 'article';
  const title = actionHint ? `${name} — ${actionHint}` : name;
  const redeemHover = interactive && hoverLabel != null;
  const interactiveClass = redeemHover
    ? 'group relative cursor-pointer transition-[box-shadow,border-color,background-color,opacity] duration-150 hover:border-green/40 hover:bg-green/[0.07] hover:shadow-[0_0_16px_rgba(34,197,94,0.28)]'
    : interactive
      ? 'group cursor-pointer hover:border-accent/25 hover:bg-accent/[0.06]'
      : '';

  const tileBaseClass = `${MARKET_SUBCARD} dividend-payout-tile`;

  if (tileSize === 'compact') {
    return (
      <Tag
        type={interactive ? 'button' : undefined}
        onClick={onClick}
        title={title}
        aria-label={interactive ? (ariaLabel ?? `${name}, ${formatCurrency(amountEur, 'EUR')}`) : undefined}
        className={`${tileBaseClass} flex h-full w-full min-h-0 min-w-0 flex-row items-center ${preset.stackGap} ${preset.pad} overflow-hidden text-left font-sans transition-colors ${interactiveClass} ${className}`}
      >
        <IssuerLogo ticker={ticker} name={name} size={preset.logoPx} />
        <div className="min-w-0 flex-1 flex flex-col justify-center gap-0 leading-none">
          <span
            className={`w-full truncate font-sans font-bold tabular-nums text-text-p ${preset.amountClass}`}
          >
            {formatCurrency(amountEur, 'EUR')}
          </span>
          <span className={`w-full truncate text-text-s/55 font-sans ${preset.metaClass}`}>
            {metaLine ?? '—'}
          </span>
        </div>
      </Tag>
    );
  }

  return (
    <Tag
      type={interactive ? 'button' : undefined}
      onClick={onClick}
      title={title}
      aria-label={interactive ? (ariaLabel ?? `${name}, ${formatCurrency(amountEur, 'EUR')}`) : undefined}
      className={`${tileBaseClass} flex h-full w-full min-h-0 min-w-0 flex-col items-center justify-center ${preset.stackGap} ${preset.pad} overflow-hidden text-center font-sans ${interactiveClass} ${className}`}
    >
      {hoverLabel ? (
        <span
          className={`pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center pt-1 font-sans font-bold uppercase tracking-widest text-green opacity-0 transition-opacity duration-150 group-hover:opacity-100 ${
            tileSize === 'featured' ? 'text-[10px]' : 'text-[8px]'
          }`}
          aria-hidden
        >
          {hoverLabel}
        </span>
      ) : null}
      <div className="shrink-0 flex items-center justify-center">
        <IssuerLogo ticker={ticker} name={name} size={preset.logoPx} />
      </div>
      <div className={`flex min-w-0 w-full flex-col items-center ${preset.textGap} leading-none`}>
        <span
          className={`max-w-full truncate font-sans font-bold tabular-nums tracking-tight text-text-p ${preset.amountClass}`}
        >
          {formatCurrency(amountEur, 'EUR')}
        </span>
        <span
          className={`max-w-full truncate font-sans font-medium tabular-nums text-text-s/65 ${preset.metaClass}`}
        >
          {metaLine ?? '—'}
        </span>
      </div>
    </Tag>
  );
}

function MonthSectionHeader({
  monthKey,
  totalEur,
  totalClassName = 'text-accent',
  received = false,
}: {
  monthKey: string;
  totalEur: number;
  totalClassName?: string;
  received?: boolean;
}) {
  return (
    <div
      className={`flex items-end justify-between gap-2 px-0.5 shrink-0 ${
        received ? 'border-b border-border/25 pb-1.5 mb-1.5' : 'pb-2'
      }`}
    >
      <span className={`micro-label mb-0 ${received ? 'text-text-s/70' : ''}`}>
        {formatMonthYearFi(monthKey)}
      </span>
      <span className={`font-sans text-xs font-bold tabular-nums leading-none shrink-0 ${totalClassName}`}>
        {formatCurrency(totalEur, 'EUR')}
      </span>
    </div>
  );
}

function MonthPayoutRow({
  monthKey,
  totalEur,
  totalClassName,
  received = false,
  children,
}: {
  monthKey: string;
  totalEur: number;
  totalClassName?: string;
  received?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0">
      <MonthSectionHeader
        monthKey={monthKey}
        totalEur={totalEur}
        totalClassName={totalClassName}
        received={received}
      />
      <ul className={historyTileRowClass()}>{children}</ul>
    </section>
  );
}

function UpcomingFeaturedGrid({
  payments,
  exitingId,
  onRedeem,
}: {
  payments: ScheduledDividendPayment[];
  exitingId: string | null;
  onRedeem: (payment: ScheduledDividendPayment) => void;
}) {
  const sorted = useMemo(() => sortByPayDateAsc(payments), [payments]);
  const featured = sorted[0];
  const cluster = sorted.slice(1, 5);

  if (!featured) return null;

  const renderCard = (
    payment: ScheduledDividendPayment,
    tileSize: 'featured' | 'cluster',
    extraClass = ''
  ) => (
    <DividendPayoutCard
      name={payment.name}
      ticker={payment.ticker}
      metaLine={payoutMetaLine(payment)}
      amountEur={payment.amountEur}
      tileSize={tileSize}
      onClick={() => onRedeem(payment)}
      actionHint="Click to redeem"
      hoverLabel="Redeem"
      className={`${exitingId === payment.id ? '!bg-green/20 opacity-60' : ''} ${extraClass}`.trim()}
    />
  );

  if (cluster.length === 0) {
    return (
      <div className="flex flex-1 h-full w-full min-h-0 items-center justify-center px-2">
        <div className="max-w-[11rem] w-full aspect-square min-h-[9rem]">
          {renderCard(featured, 'featured', 'dividend-payout-tile-featured h-full')}
        </div>
      </div>
    );
  }

  return (
    <div className="dividend-upcoming-grid h-full w-full min-h-0 min-w-0">
      <div className="dividend-upcoming-featured min-h-0 min-w-0">
        {renderCard(featured, 'featured', 'dividend-payout-tile-featured h-full')}
      </div>
      <ul className="dividend-upcoming-cluster list-none m-0 p-0 min-h-0 min-w-0">
        {cluster.map((payment) => (
          <li key={payment.id} className="min-h-0 min-w-0">
            {renderCard(payment, 'cluster')}
          </li>
        ))}
      </ul>
    </div>
  );
}

function payoutMetaLine(payment: ScheduledDividendPayment): string {
  if (payment.payDateYmd) {
    const date = formatShortMonthDayEn(payment.payDateYmd);
    if (payment.payDateSource === 'estimated' || payment.payDateSource === 'fallback') {
      return `~${date}`;
    }
    return date;
  }
  if (payment.payDateSource === 'yahoo') return 'Official';
  if (payment.payDateSource === 'manual') return 'Manual';
  if (payment.payDateSource === 'estimated' || payment.payDateSource === 'fallback') return 'Est.';
  return '—';
}

type MonthGroup = {
  monthKey: string;
  totalEur: number;
  payments: ScheduledDividendPayment[];
};

function UpcomingMonthsPanel({
  groups,
  exitingId,
  onRedeem,
}: {
  groups: MonthGroup[];
  exitingId: string | null;
  onRedeem: (payment: ScheduledDividendPayment) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex((i) => (i >= groups.length ? Math.max(0, groups.length - 1) : i));
  }, [groups.length]);

  if (groups.length === 0) return null;

  const activeGroup = groups[activeIndex];

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      <div className="flex items-center justify-between gap-2 shrink-0 pb-1.5 px-0.5">
        <div className={DIVIDEND_MONTH_NAV_PILL}>
          <button
            type="button"
            onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
            disabled={activeIndex <= 0}
            className={DIVIDEND_MONTH_NAV_BTN}
            aria-label="Previous month"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className={DIVIDEND_MONTH_NAV_LABEL}>{formatMonthYearFi(activeGroup.monthKey)}</span>
          <button
            type="button"
            onClick={() => setActiveIndex((i) => Math.min(groups.length - 1, i + 1))}
            disabled={activeIndex >= groups.length - 1}
            className={DIVIDEND_MONTH_NAV_BTN}
            aria-label="Next month"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <span className="font-sans text-sm font-bold tabular-nums text-accent shrink-0">
          {formatCurrency(activeGroup.totalEur, 'EUR')}
        </span>
      </div>

      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
        <UpcomingFeaturedGrid
          payments={activeGroup.payments}
          exitingId={exitingId}
          onRedeem={onRedeem}
        />
      </div>
    </div>
  );
}

type DividendPayoutCalendarProps = {
  apiRows: ApiDividendPaymentInput[];
  manualRows: ManualDividendPaymentInput[];
  loading?: boolean;
  hasHoldings: boolean;
};

export function DividendPayoutCalendar({
  apiRows,
  manualRows,
  loading = false,
  hasHoldings,
}: DividendPayoutCalendarProps) {
  const [redeemed, setRedeemed] = useState<RedeemedDividendPayment[]>(() => loadRedeemed());
  const [dividendTaxRatePercent, setDividendTaxRatePercent] = useState(
    () => loadFireInputs().capital.dividendTaxRatePercent
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exitingId, setExitingId] = useState<string | null>(null);
  const announceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => setRedeemed(loadRedeemed());
    window.addEventListener(REDEEMED_DIVIDENDS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(REDEEMED_DIVIDENDS_CHANGED_EVENT, sync);
  }, []);

  useEffect(() => {
    const syncTax = () => setDividendTaxRatePercent(loadFireInputs().capital.dividendTaxRatePercent);
    window.addEventListener(FIRE_INPUTS_CHANGED_EVENT, syncTax);
    return () => window.removeEventListener(FIRE_INPUTS_CHANGED_EVENT, syncTax);
  }, []);

  const projected = useMemo(
    () => buildProjectedPayments(apiRows, manualRows, redeemed, undefined, dividendTaxRatePercent),
    [apiRows, manualRows, redeemed, dividendTaxRatePercent]
  );

  const upcomingGroups = useMemo(() => groupScheduledByMonth(projected, false), [projected]);
  const historyGroups = useMemo(() => groupRedeemedByMonth(redeemed, true), [redeemed]);

  const hasSources = apiRows.length > 0 || manualRows.length > 0;
  const upcomingEmpty = upcomingGroups.length === 0;

  const commitRedeem = useCallback(
    (payment: ScheduledDividendPayment) => {
      const next = redeemPayment(redeemed, payment);
      saveRedeemed(next);
      setRedeemed(next);
    },
    [redeemed]
  );

  const handleRedeem = useCallback(
    (payment: ScheduledDividendPayment) => {
      if (exitingId) return;
      setExitingId(payment.id);
      playRedeemChime();
      const msg = formatRedeemAnnouncement(payment.name, payment.amountEur);
      if (announceRef.current) announceRef.current.textContent = msg;
      window.setTimeout(() => {
        commitRedeem(payment);
        setExitingId(null);
      }, 200);
    },
    [commitRedeem, exitingId]
  );

  const handleUndo = (id: string) => {
    const next = unredeemPayment(redeemed, id);
    saveRedeemed(next);
    setRedeemed(next);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden font-sans">
      <div
        ref={announceRef}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />

      <div className="flex flex-col flex-1 min-h-0 overflow-hidden px-0.5">
        {loading && !hasSources ? (
          <div className="flex flex-1 min-h-0" role="status" aria-label="Loading dividend calendar">
            <SkeletonDividendCalendar />
          </div>
        ) : !hasSources ? (
          <div className={`${MARKET_SUBCARD} mx-0.5 p-3`}>
            <p className="m-0 text-sm text-text-s/80 text-center leading-relaxed">
              {hasHoldings ? 'No dividend income on file' : 'No holdings'}
            </p>
          </div>
        ) : upcomingEmpty ? (
          <div className={`${MARKET_SUBCARD} mx-0.5 p-3`}>
            <p className="m-0 text-sm text-text-s/80 text-center leading-relaxed">
              All projected payments marked received — undo below or wait for next month
            </p>
          </div>
        ) : (
          <UpcomingMonthsPanel groups={upcomingGroups} exitingId={exitingId} onRedeem={handleRedeem} />
        )}
      </div>

      <div className="shrink-0 border-t border-border/40 pt-1.5 mt-1.5">
        <button
          type="button"
          onClick={() => setHistoryOpen((o) => !o)}
          className={`flex w-full items-center justify-between gap-2 text-left min-w-0 px-2 py-1.5 -mx-0.5 shrink-0 rounded-lg transition-colors hover:bg-white/[0.04] ${
            historyOpen ? 'bg-white/[0.03] border border-border/30' : 'border border-transparent'
          }`}
        >
          <span className="micro-label mb-0">
            Received{' '}
            {redeemed.length > 0 ? (
              <span className="text-green/90">({redeemed.length})</span>
            ) : (
              <span className="text-text-s/50">(0)</span>
            )}
          </span>
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/40">
            {historyOpen ? (
              <ChevronUp className="w-3.5 h-3.5 text-text-s" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-text-s" />
            )}
          </span>
        </button>
        {historyOpen && (
          <div className="dividend-received-scroll mt-2 max-h-[8.5rem] overflow-y-auto overflow-x-hidden px-0.5">
            {historyGroups.length === 0 ? (
              <p className="text-sm text-text-s/70 text-center py-3">Nothing redeemed yet</p>
            ) : (
              <div className="flex flex-col gap-1.5 pb-0.5 min-w-0">
                {historyGroups.map((group) => (
                  <MonthPayoutRow
                    key={group.monthKey}
                    monthKey={group.monthKey}
                    totalEur={group.totalEur}
                    totalClassName="text-green"
                    received
                  >
                    {group.payments.map((payment) => (
                      <li key={payment.id}>
                        <DividendPayoutCard
                          name={payment.name}
                          ticker={payment.ticker}
                          metaLine={formatDateFi(payment.redeemedAt.slice(0, 10))}
                          amountEur={payment.amountEur}
                          tileSize="compact"
                          onClick={() => handleUndo(payment.id)}
                          ariaLabel={`Undo redeem for ${payment.name}`}
                          actionHint="Click to undo"
                          className="dividend-payout-tile-received hover:border-green/30 hover:bg-green/[0.06]"
                        />
                      </li>
                    ))}
                  </MonthPayoutRow>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
