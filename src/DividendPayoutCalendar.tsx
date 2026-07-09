import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Volume2, VolumeX } from 'lucide-react';
import { formatCurrency } from './formatCurrency';
import { formatDateFi, formatMonthYearFi, formatShortMonthDayEn } from './formatDate';
import { AssetNameCell } from './AssetNameCell';
import { MARKET_SUBCARD } from './marketTheme';
import {
  type ApiDividendPaymentInput,
  type ManualDividendPaymentInput,
  type PayDateSource,
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
import {
  formatRedeemAnnouncement,
  isRedeemMuted,
  playRedeemChime,
  setRedeemMuted,
} from './redeemDividendFeedback';
import { SkeletonDividendCalendar } from './SkeletonPulse';
import { loadFireInputs, FIRE_INPUTS_CHANGED_EVENT } from './fireStorage';

const PAYOUT_SOURCE_BADGE =
  'inline-flex items-center rounded-md border border-border/40 bg-white/5 px-1.5 py-0.5 text-[9px] font-sans font-bold uppercase tracking-widest text-text-s/80';

function payoutSourceLabel(source: PayDateSource | undefined): string | null {
  if (source === 'yahoo') return 'Official';
  if (source === 'manual') return 'Manual';
  if (source === 'estimated' || source === 'fallback') return 'Est.';
  return null;
}

function PayoutSourceBadge({ source }: { source: PayDateSource | undefined }) {
  const label = payoutSourceLabel(source);
  if (!label) return null;
  return <span className={PAYOUT_SOURCE_BADGE}>{label}</span>;
}

function DividendPayoutCard({
  name,
  ticker,
  subline,
  source,
  amountEur,
  trailing,
  onClick,
  ariaLabel,
  className = '',
}: {
  name: string;
  ticker: string;
  subline?: string;
  source?: PayDateSource;
  amountEur: number;
  trailing?: React.ReactNode;
  onClick?: () => void;
  ariaLabel?: string;
  className?: string;
}) {
  const interactive = onClick != null;
  const Tag = interactive ? 'button' : 'article';

  return (
    <Tag
      type={interactive ? 'button' : undefined}
      onClick={onClick}
      title={name}
      aria-label={interactive ? (ariaLabel ?? name) : undefined}
      className={`${MARKET_SUBCARD} flex h-full min-h-[3.75rem] w-full min-w-0 flex-col justify-between gap-1.5 px-2.5 py-2 text-left font-sans transition-colors ${interactive ? 'group cursor-pointer hover:border-accent/25 hover:bg-accent/[0.06]' : ''} ${className}`}
    >
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0 flex-1">
          <AssetNameCell name={name} ticker={ticker} variant="dense" subline={subline} />
        </div>
        <div className="shrink-0 text-right">
          <span className="font-sans text-sm font-bold tabular-nums leading-none text-text-p">
            {formatCurrency(amountEur, 'EUR')}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 min-w-0">
        {source ? <PayoutSourceBadge source={source} /> : <span aria-hidden className="min-w-0" />}
        <div className="shrink-0">{trailing}</div>
      </div>
    </Tag>
  );
}

function MonthSectionHeader({
  monthKey,
  totalEur,
  totalLabel = 'Month total',
  totalClassName = 'text-accent',
}: {
  monthKey: string;
  totalEur: number;
  totalLabel?: string;
  totalClassName?: string;
}) {
  return (
    <div className="flex items-end justify-between gap-3 px-0.5 pt-0.5 pb-2">
      <span className="micro-label mb-0">{formatMonthYearFi(monthKey)}</span>
      <div className="flex items-baseline gap-1.5 shrink-0">
        <span className="micro-label mb-0 text-text-s/60">{totalLabel}</span>
        <span className={`font-sans text-xs font-bold tabular-nums leading-none ${totalClassName}`}>
          {formatCurrency(totalEur, 'EUR')}
        </span>
      </div>
    </div>
  );
}

function MonthPayoutRow({
  monthKey,
  totalEur,
  totalLabel,
  totalClassName,
  paymentCount,
  children,
}: {
  monthKey: string;
  totalEur: number;
  totalLabel?: string;
  totalClassName?: string;
  paymentCount: number;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0">
      <MonthSectionHeader
        monthKey={monthKey}
        totalEur={totalEur}
        totalLabel={totalLabel}
        totalClassName={totalClassName}
      />
      <ul
        className={
          paymentCount > 3
            ? 'flex flex-nowrap gap-2 overflow-x-auto list-none m-0 p-0 pb-0.5 [&>li]:shrink-0 [&>li]:w-[9.5rem]'
            : 'grid gap-2 list-none m-0 p-0 [&>li]:min-w-0'
        }
        style={
          paymentCount <= 3
            ? { gridTemplateColumns: `repeat(${paymentCount}, minmax(0, 1fr))` }
            : undefined
        }
      >
        {children}
      </ul>
    </section>
  );
}

function MonthRowsLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-3 pb-0.5 min-w-0">{children}</div>;
}

function payoutDateSubline(payment: ScheduledDividendPayment): string | undefined {
  if (payment.payDateYmd) {
    return formatShortMonthDayEn(payment.payDateYmd);
  }
  if (payment.payDateSource === 'fallback') {
    return 'Date estimated';
  }
  return undefined;
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
  const [muted, setMuted] = useState(() => isRedeemMuted());
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

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setRedeemMuted(next);
  };

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

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-0.5">
        {loading && !hasSources ? (
          <div role="status" aria-label="Loading dividend calendar">
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
          <MonthRowsLayout>
            {upcomingGroups.map((group) => (
              <MonthPayoutRow
                key={group.monthKey}
                monthKey={group.monthKey}
                totalEur={group.totalEur}
                paymentCount={group.payments.length}
              >
                {group.payments.map((payment) => (
                  <li key={payment.id} className="min-w-0">
                    <DividendPayoutCard
                      name={payment.name}
                      ticker={payment.ticker}
                      subline={payoutDateSubline(payment)}
                      source={payment.payDateSource}
                      amountEur={payment.amountEur}
                      onClick={() => handleRedeem(payment)}
                      className={exitingId === payment.id ? '!bg-green/20 opacity-60' : ''}
                      trailing={
                        <span className="text-[9px] font-bold uppercase tracking-wide text-green/70 group-hover:text-green transition-colors">
                          Redeem
                        </span>
                      }
                    />
                  </li>
                ))}
              </MonthPayoutRow>
            ))}
          </MonthRowsLayout>
        )}
      </div>

      <div className="shrink-0 border-t border-border/40 pt-2 mt-2">
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setHistoryOpen((o) => !o)}
            className="flex flex-1 items-center justify-between gap-2 text-left min-w-0 px-0.5"
          >
            <span className="micro-label mb-0">Received ({redeemed.length})</span>
            {historyOpen ? (
              <ChevronUp className="w-3.5 h-3.5 text-text-s shrink-0" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-text-s shrink-0" />
            )}
          </button>
          <button
            type="button"
            onClick={toggleMute}
            className="p-1.5 rounded-lg text-text-s hover:text-text-p hover:bg-white/5 shrink-0"
            title={muted ? 'Unmute redeem sound' : 'Mute redeem sound'}
            aria-pressed={muted}
          >
            {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>
        </div>
        {historyOpen && (
          <div className="mt-2 max-h-[7rem] overflow-y-auto overflow-x-hidden px-0.5">
            {historyGroups.length === 0 ? (
              <p className="text-sm text-text-s/70 text-center py-3">Nothing redeemed yet</p>
            ) : (
              <MonthRowsLayout>
                {historyGroups.map((group) => (
                  <MonthPayoutRow
                    key={group.monthKey}
                    monthKey={group.monthKey}
                    totalEur={group.totalEur}
                    totalClassName="text-green"
                    paymentCount={group.payments.length}
                  >
                    {group.payments.map((payment) => (
                      <li key={payment.id} className="min-w-0">
                        <DividendPayoutCard
                          name={payment.name}
                          ticker={payment.ticker}
                          subline={`Redeemed ${formatDateFi(payment.redeemedAt.slice(0, 10))}`}
                          source={
                            payment.payDateSource ??
                            (payment.source === 'manual' ? 'manual' : 'estimated')
                          }
                          amountEur={payment.amountEur}
                          onClick={() => handleUndo(payment.id)}
                          ariaLabel={`Undo redeem for ${payment.name}`}
                          trailing={
                            <span className="text-[9px] font-bold uppercase tracking-wide text-text-s/60 group-hover:text-accent transition-colors">
                              Undo
                            </span>
                          }
                        />
                      </li>
                    ))}
                  </MonthPayoutRow>
                ))}
              </MonthRowsLayout>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
