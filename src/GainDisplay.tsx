import { formatCurrency } from './formatCurrency';
import { formatPercentFi } from './formatNumber';

/** EUR gain from a prior close given current market value and % change. */
export function todayGainEurFromChange(marketValueEur: number, changePercent: number): number {
  if (marketValueEur <= 0 || changePercent === 0) return 0;
  const factor = 1 + changePercent / 100;
  if (factor === 0) return 0;
  return marketValueEur - marketValueEur / factor;
}

export function GainDisplay({ amountEur, percent }: { amountEur: number; percent: number }) {
  const positive = amountEur >= 0;
  return (
    <div className={`inline-block text-right ${positive ? 'text-green' : 'text-red'}`}>
      <div className="text-[11px] font-sans font-bold tabular-nums">
        {formatCurrency(amountEur, 'EUR')}
      </div>
      <div className="text-xs opacity-60 font-bold">
        {formatPercentFi(percent, 2, { showPlus: true })}
      </div>
    </div>
  );
}
