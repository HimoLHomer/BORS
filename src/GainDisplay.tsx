import { useEffect, useRef, useState } from 'react';
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
}: {
  amountEur: number;
  percent: number;
  loading?: boolean;
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

  return (
    <div
      className={`inline-block text-right rounded-md px-1 -mx-1 ${positive ? 'text-green' : 'text-red'} ${
        flash === 'up' ? 'gain-flash-up' : flash === 'down' ? 'gain-flash-down' : ''
      }`}
    >
      <div className="text-[11px] font-sans font-bold tabular-nums">
        {formatCurrency(amountEur, 'EUR')}
      </div>
      <div className="text-xs opacity-60 font-bold">
        {formatPercentEn(percent, 2, { showPlus: true })}
      </div>
    </div>
  );
}
