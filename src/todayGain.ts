import { todayGainEurFromChange } from './GainDisplay';
import type { PortfolioFlow } from './types';
import { NEW_HOLDING_NOTE, TRANSFER_IN_NOTE } from './flowNotes';

export type TodayPurchase = { newHolding: boolean; costEur: number };

/** Today's purchases per symbol (EUR paid). Holdings added as already owned are not purchases. */
export function todaysPurchasesBySymbol(
  flows: Pick<PortfolioFlow, 'date' | 'kind' | 'assetSymbol' | 'amountEur' | 'note'>[],
  todayIso: string
): Map<string, TodayPurchase> {
  const out = new Map<string, TodayPurchase>();
  for (const f of flows) {
    if (f.date !== todayIso || f.kind !== 'buy' || !f.assetSymbol || !(f.amountEur > 0)) continue;
    if (f.note === TRANSFER_IN_NOTE) continue;
    const prev = out.get(f.assetSymbol) ?? { newHolding: false, costEur: 0 };
    out.set(f.assetSymbol, {
      newHolding: prev.newHolding || f.note === NEW_HOLDING_NOTE,
      costEur: prev.costEur + f.amountEur,
    });
  }
  return out;
}

/**
 * Today's gain for one holding. Shares bought today only count their move since purchase:
 * a holding opened today gains (value − price paid); a top-up today leaves the day's move to
 * the shares held before (the new shares are assumed bought near the current price).
 */
export function holdingTodayGainEur(
  valueEur: number,
  changePercent: number,
  purchase: TodayPurchase | undefined
): number {
  if (!purchase) return todayGainEurFromChange(valueEur, changePercent);
  if (purchase.newHolding) return valueEur - purchase.costEur;
  return todayGainEurFromChange(Math.max(0, valueEur - purchase.costEur), changePercent);
}

/** Percent for a gain relative to the value before it. */
export function gainPercentOf(valueEur: number, gainEur: number): number {
  const before = valueEur - gainEur;
  return before > 0 ? (gainEur / before) * 100 : 0;
}
