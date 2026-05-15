import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { formatCurrency } from './formatCurrency';
import { formatDateFi, formatMonthYearFi } from './formatDate';
import { DataListTable, dataListRowClassName } from './DataListTable';
import { AssetNameCell } from './AssetNameCell';
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
import {
  formatRedeemAnnouncement,
  isRedeemMuted,
  playRedeemChime,
  setRedeemMuted,
} from './redeemDividendFeedback';
import { SkeletonDividendCalendar } from './SkeletonPulse';

const CALENDAR_TABLE_MIN = 280;

const CALENDAR_CELL_ASSET = 'px-2 py-1.5 text-left text-text-s/90';
const CALENDAR_CELL_AMOUNT = 'px-2 py-1.5 text-right text-text-p text-[11px] tabular-nums';
const CALENDAR_CELL_ACTION = 'w-11 px-1 py-1.5 text-right';

const UPCOMING_COLUMNS = [
  { key: 'asset', label: '', cellClassName: CALENDAR_CELL_ASSET },
  { key: 'amount', label: '', align: 'right' as const, cellClassName: CALENDAR_CELL_AMOUNT },
  {
    key: 'action',
    label: '',
    align: 'right' as const,
    cellClassName: CALENDAR_CELL_ACTION,
  },
];

const HISTORY_COLUMNS = [
  { key: 'asset', label: '', cellClassName: CALENDAR_CELL_ASSET },
  { key: 'amount', label: '', align: 'right' as const, cellClassName: CALENDAR_CELL_AMOUNT },
  {
    key: 'action',
    label: '',
    align: 'right' as const,
    cellClassName: CALENDAR_CELL_ACTION,
  },
];

const MONTH_LABEL =
  'text-[9px] font-bold text-text-s uppercase tracking-[0.2em] opacity-50';

function MonthSectionHeader({
  monthKey,
  totalEur,
  totalLabel,
  totalClassName = 'text-accent',
}: {
  monthKey: string;
  totalEur: number;
  totalLabel: string;
  totalClassName?: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_2.75rem] items-end gap-x-1 -mx-2 px-2 pt-2 pb-1.5">
      <span className={`${MONTH_LABEL} truncate`}>{formatMonthYearFi(monthKey)}</span>
      <div className="flex items-baseline justify-end gap-1.5 min-w-0">
        <span className="micro-label shrink-0 mb-0">{totalLabel}</span>
        <span className={`text-[11px] font-mono tabular-nums font-bold leading-none shrink-0 ${totalClassName}`}>
          {formatCurrency(totalEur, 'EUR')}
        </span>
      </div>
      <span aria-hidden className="w-11" />
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
  const [muted, setMuted] = useState(() => isRedeemMuted());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exitingId, setExitingId] = useState<string | null>(null);
  const announceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => setRedeemed(loadRedeemed());
    window.addEventListener(REDEEMED_DIVIDENDS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(REDEEMED_DIVIDENDS_CHANGED_EVENT, sync);
  }, []);

  const projected = useMemo(
    () => buildProjectedPayments(apiRows, manualRows, redeemed),
    [apiRows, manualRows, redeemed]
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

  const upcomingTableSections = useMemo(() => {
    let stripe = 0;
    return upcomingGroups.map((group) => {
      const stripeStart = stripe;
      const rows = group.payments.map((p) => {
        stripe += 1;
        return {
          asset: <AssetNameCell name={p.name} ticker={p.ticker} variant="dense" />,
          amount: formatCurrency(p.amountEur, 'EUR'),
          action: (
            <span className="text-[8px] font-black uppercase tracking-widest text-green opacity-0 group-hover:opacity-100 transition-opacity">
              Redeem
            </span>
          ),
        };
      });
      return { group, stripeStart, rows };
    });
  }, [upcomingGroups]);

  const historyTableSections = useMemo(() => {
    let stripe = upcomingTableSections.reduce((n, s) => n + s.rows.length, 0);
    return historyGroups.map((group) => {
      const stripeStart = stripe;
      const rows = group.payments.map((p) => {
        stripe += 1;
        return {
          asset: (
            <AssetNameCell
              name={p.name}
              ticker={p.ticker}
              variant="dense"
              subline={`${p.ticker} · Redeemed ${formatDateFi(p.redeemedAt.slice(0, 10))}`}
            />
          ),
          amount: formatCurrency(p.amountEur, 'EUR'),
          action: (
            <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleUndo(p.id);
                }}
                className="p-1 text-text-s hover:text-accent hover:bg-accent/10 rounded-md shrink-0"
                title="Undo redeem"
                aria-label={`Undo redeem for ${p.name}`}
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          ),
        };
      });
      return { group, stripeStart, rows };
    });
  }, [historyGroups, upcomingTableSections]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div
        ref={announceRef}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hidden">
        {loading && !hasSources ? (
          <div role="status" aria-label="Loading dividend calendar">
            <SkeletonDividendCalendar />
          </div>
        ) : !hasSources ? (
          <p className="text-text-s/50 py-8 text-center text-[10px] font-bold uppercase tracking-widest px-2">
            {hasHoldings ? 'No dividend income on file' : 'No holdings'}
          </p>
        ) : upcomingEmpty ? (
          <p className="text-text-s/50 py-8 text-center text-[10px] font-bold uppercase tracking-widest px-2 leading-relaxed">
            All projected payments marked received — undo below or wait for next month
          </p>
        ) : (
          <div className="space-y-3">
            {upcomingTableSections.map(({ group, stripeStart, rows }) => (
              <section key={group.monthKey}>
                <MonthSectionHeader
                  monthKey={group.monthKey}
                  totalEur={group.totalEur}
                  totalLabel="Month total"
                />
                <DataListTable
                  minWidth={CALENDAR_TABLE_MIN}
                  columns={UPCOMING_COLUMNS}
                  showHeader={false}
                  tableClassName="border-spacing-y-1 text-[11px]"
                  rows={rows}
                  rowClassName={(i) => {
                    const p = group.payments[i]!;
                    const base = dataListRowClassName(stripeStart + i);
                    if (exitingId === p.id) return `${base} !bg-green/20 opacity-60`;
                    return base;
                  }}
                  onRowClick={(i) => handleRedeem(group.payments[i]!)}
                />
              </section>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border/40 pt-2 mt-1">
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setHistoryOpen((o) => !o)}
            className="flex flex-1 items-center justify-between gap-2 text-left min-w-0"
          >
            <span className="micro-label mb-0 py-0 px-2">Received ({redeemed.length})</span>
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
          <div className="mt-1.5 max-h-[7rem] overflow-y-auto scrollbar-hidden">
            {historyGroups.length === 0 ? (
              <p className="text-text-s/50 text-[10px] font-bold uppercase tracking-widest text-center py-3">
                Nothing redeemed yet
              </p>
            ) : (
              <div className="space-y-3">
                {historyTableSections.map(({ group, stripeStart, rows }) => (
                  <section key={group.monthKey}>
                    <MonthSectionHeader
                      monthKey={group.monthKey}
                      totalEur={group.totalEur}
                      totalLabel="Month total"
                      totalClassName="text-green"
                    />
                    <DataListTable
                      minWidth={CALENDAR_TABLE_MIN}
                      columns={HISTORY_COLUMNS}
                      showHeader={false}
                      tableClassName="border-spacing-y-1 text-[11px]"
                      rows={rows}
                      rowClassName={(i) => dataListRowClassName(stripeStart + i)}
                    />
                  </section>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
