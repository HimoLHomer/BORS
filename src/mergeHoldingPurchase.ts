import { convertAmountBetweenCurrencies, fxToEur } from './formatCurrency';

export type MergeHoldingPurchaseResult =
  | {
      quantity: number;
      averagePrice: number;
      totalCostBasis: number;
      totalCostBasisEur: number;
    }
  | { error: string };

function missingRateMessage(currency: string): string {
  return `Missing FX rate for ${currency}. Wait for the market feed to connect.`;
}

function requireFxRate(currency: string, exchangeRates: Record<string, number>): number | null {
  const c = (currency || 'EUR').toUpperCase();
  if (c === 'EUR') return 1;
  const rate = fxToEur(c, exchangeRates);
  return rate > 0 ? rate : null;
}

export function mergeHoldingPurchase(args: {
  quantity: number;
  averagePrice: number;
  holdingCurrency: string;
  addQuantity: number;
  addPricePerUnit: number;
  addCurrency: string;
  exchangeRates: Record<string, number>;
}): MergeHoldingPurchaseResult {
  const holding = (args.holdingCurrency || 'EUR').toUpperCase();
  const addCcy = (args.addCurrency || holding).toUpperCase();

  if (!(args.addQuantity > 0)) {
    return { error: 'Enter a positive number of shares to add.' };
  }
  const addQuantity = Math.floor(args.addQuantity + 1e-9);
  if (!(addQuantity > 0)) {
    return { error: 'Enter a positive number of shares to add.' };
  }
  if (args.addPricePerUnit < 0 || !Number.isFinite(args.addPricePerUnit)) {
    return { error: 'Enter a valid purchase price per unit.' };
  }
  if (!Number.isFinite(args.quantity) || args.quantity < 0) {
    return { error: 'Current holding quantity is invalid.' };
  }
  const baseQuantity = Math.floor(args.quantity + 1e-9);
  if (!Number.isFinite(args.averagePrice) || args.averagePrice < 0) {
    return { error: 'Current average cost is invalid.' };
  }

  if (requireFxRate(holding, args.exchangeRates) == null) {
    return { error: missingRateMessage(holding) };
  }
  if (addCcy !== holding && requireFxRate(addCcy, args.exchangeRates) == null) {
    return { error: missingRateMessage(addCcy) };
  }

  const addPriceInHolding = convertAmountBetweenCurrencies(
    args.addPricePerUnit,
    addCcy,
    holding,
    args.exchangeRates
  );
  if (addPriceInHolding == null) {
    return { error: missingRateMessage(addCcy !== holding ? addCcy : holding) };
  }

  const costOld = baseQuantity * args.averagePrice;
  const costAdd = addQuantity * addPriceInHolding;
  const quantity = baseQuantity + addQuantity;
  if (!(quantity > 0)) {
    return { error: 'Total quantity must be greater than zero.' };
  }

  const averagePrice = (costOld + costAdd) / quantity;
  const totalCostBasis = quantity * averagePrice;
  const holdingFx = fxToEur(holding, args.exchangeRates) || 1;
  const totalCostBasisEur = totalCostBasis * holdingFx;

  return {
    quantity,
    averagePrice,
    totalCostBasis,
    totalCostBasisEur,
  };
}
