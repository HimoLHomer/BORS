import { useEffect, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { formatCurrency } from './formatCurrency';
import { formatPercentEn } from './formatNumber';
import { SkeletonGain } from './SkeletonPulse';

/** EUR gain from a prior close given current market value and % change. */
export function todayGainEurFromChange(marketValueEur: number, changePercent: number): number {
  if (marketValueEur <= 0 || changePercent === 0) return 0;
  const factor = 1 + changePercent / 100;
  if (factor === 0) return 0;
  return marketValueEur - marketValueEur / factor;
}

export function GainDisplay({
  amountEur,
  percent,
  loading = false,
  variant = 'stacked',
}: {
  amountEur: number;
  percent: number;
  loading?: boolean;
  /** stacked: amount over percent (tables). pill: one tinted pill with an arrow (headline figures). */
  variant?: 'stacked' | 'pill';
}) {
  const positive = amountEur >= 0;
  const prevRef = useRef({ amountEur, percent });
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (loading) return;
    const prev = prevRef.current;
    const changed =
      Math.abs(prev.amountEur - amountEur) > 0.005 || Math.abs(prev.percent - percent) > 0.005;
    if (changed && (prev.amountEur !== 0 || prev.percent !== 0)) {
      const nextFlash = amountEur >= 0 ? 'up' : 'down';
      setFlash(nextFlash);
      const id = window.setTimeout(() => setFlash(null), 450);
      prevRef.current = { amountEur, percent };
      return () => window.clearTimeout(id);
    }
    prevRef.current = { amountEur, percent };
  }, [amountEur, percent, loading]);

  if (loading) return <SkeletonGain />;

  const flashClass = flash === 'up' ? 'gain-flash-up' : flash === 'down' ? 'gain-flash-down' : '';

  if (variant === 'pill') {
    const Arrow = positive ? ArrowUpRight : ArrowDownRight;
    return (
      <span className={`change-pill ${positive ? 'bg-green-soft text-green' : 'bg-red-soft text-red'} ${flashClass}`}>
        <Arrow className="w-3.5 h-3.5" aria-hidden />
        {formatCurrency(amountEur, 'EUR')}
        <span className="opacity-75">({formatPercentEn(percent, 2, { showPlus: true })})</span>
      </span>
    );
  }

  return (
    <div
      className={`inline-block text-right rounded-md px-1 -mx-1 ${positive ? 'text-green' : 'text-red'} ${flashClass}`}
    >
      <div className="text-[13px] font-semibold tabular-nums">
        {formatCurrency(amountEur, 'EUR')}
      </div>
      <div className="text-xs opacity-70 font-medium tabular-nums">
        {formatPercentEn(percent, 2, { showPlus: true })}
      </div>
    </div>
  );
}
