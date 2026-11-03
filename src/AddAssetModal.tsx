import React, { useState, useMemo, useRef } from 'react';
import { useEscapeToClose } from './useEscapeToClose';
import { X, Search, RefreshCcw, Zap, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { Asset } from './types';
import { convertAmountBetweenCurrencies, formatCurrency, fxToEur } from './formatCurrency';
import { mergeHoldingPurchase } from './mergeHoldingPurchase';
import {
  formatDecimalEn,
  formatDecimalInputEn,
  formatPercentEn,
  parseDecimalInput,
  parseShareInput,
  formatShareInput,
  formatShares,
  sanitizeShareDraft,
} from './formatNumber';
import { EurAmountInput } from './EurAmountField';
import { MARKET_SUBCARD } from './marketTheme';
import { playAssetAddedChime } from './uiFeedback';

type AssetSearchResult = {
  symbol: string;
  shortName?: string;
  longName?: string;
  name?: string;
  price?: number;
  currency?: string;
  exchange?: string;
  dividendYieldPercent?: number | null;
  quoteType?: string;
  typeDisp?: string;
};

function assetSearchDisplayName(result: AssetSearchResult): string {
  return result.shortName || result.longName || result.name || result.symbol;
}

function assetSearchMetaLine(result: AssetSearchResult): string {
  const parts: string[] = [result.symbol];
  if (result.exchange?.trim()) parts.push(result.exchange.trim());
  if (typeof result.price === 'number' && Number.isFinite(result.price)) {
    parts.push(
      result.currency === 'EUR'
        ? formatCurrency(result.price, 'EUR')
        : formatCurrency(result.price, result.currency)
    );
  }
  return parts.join(' · ');
}

function AssetSearchResultRow({
  result,
  onSelect,
}: {
  result: AssetSearchResult;
  onSelect: (result: AssetSearchResult) => void;
}) {
  const yieldPct = result.dividendYieldPercent;
  const showYield =
    typeof yieldPct === 'number' && Number.isFinite(yieldPct) && yieldPct > 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(result)}
      className={`${MARKET_SUBCARD} w-full p-3 text-left font-sans transition-colors hover:bg-bg/40 hover:border-accent/25`}
    >
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-p truncate">{assetSearchDisplayName(result)}</div>
          <div className="mt-0.5 text-xs text-text-s/75 truncate tabular-nums">{assetSearchMetaLine(result)}</div>
        </div>
        {showYield ? (
          <span
            className="shrink-0 inline-flex items-center gap-1 rounded-md border border-green/25 bg-green/10 px-1.5 py-0.5 leading-none"
            title="Trailing / indicated dividend yield (Yahoo)"
          >
            <span className="text-xs font-medium text-green/70">Div</span>
            <span className="text-[11px] font-semibold tabular-nums text-green">
              {formatPercentEn(yieldPct, 2)}
            </span>
          </span>
        ) : null}
      </div>
    </button>
  );
}

/** Currencies offered for holdings and purchases (Yahoo quotes them all against EUR). */
const HOLDING_CURRENCIES: { code: string; label: string }[] = [
  { code: 'EUR', label: 'EUR (€)' },
  { code: 'USD', label: 'USD ($)' },
  { code: 'GBP', label: 'GBP (£)' },
  { code: 'SEK', label: 'SEK (kr)' },
  { code: 'NOK', label: 'NOK (kr)' },
  { code: 'DKK', label: 'DKK (kr)' },
  { code: 'CHF', label: 'CHF (Fr)' },
  { code: 'CAD', label: 'CAD ($)' },
  { code: 'AUD', label: 'AUD ($)' },
  { code: 'JPY', label: 'JPY (¥)' },
  { code: 'HKD', label: 'HKD ($)' },
  { code: 'PLN', label: 'PLN (zł)' },
];

/** The standard list, plus the current value if it is something else, so the form never shows a wrong currency. */
function currencyOptionsWith(current: string | undefined): { code: string; label: string }[] {
  const code = (current || '').toUpperCase();
  if (!code || HOLDING_CURRENCIES.some((c) => c.code === code)) return HOLDING_CURRENCIES;
  return [...HOLDING_CURRENCIES, { code, label: code }];
}

/** Cost this far from today's price on a new purchase suggests an older buy (shown as a hint). */
const COST_VS_PRICE_WARN_SHARE = 0.15;

export const AddAssetModal = ({ onClose, onPersist, editAsset, exchangeRates, existingAssets = [] }: {
  onClose: () => void,
  onPersist: (
    asset: Asset,
    isEdit: boolean,
    opts?: { flowAmountEur?: number; transferIn?: boolean }
  ) => Promise<void>,
  editAsset?: Asset,
  exchangeRates: Record<string, number>,
  /** Current holdings, to spot a ticker that is already held. */
  existingAssets?: Asset[],
}) => {
  useEscapeToClose(onClose);
  const [formData, setFormData] = useState({
    symbol: editAsset?.symbol || '',
    displaySymbol: editAsset?.displaySymbol || '',
    name: editAsset?.name || '',
    type: editAsset?.type || 'etf',
    quantity:
      editAsset?.quantity != null ? formatShares(editAsset.quantity) : '',
    averagePrice:
      editAsset?.averagePrice != null ? formatDecimalEn(editAsset.averagePrice, 2) : '',
    currency: editAsset?.currency || 'EUR'
  });
  const [purchaseExpanded, setPurchaseExpanded] = useState(Boolean(editAsset));
  const [purchaseAddQty, setPurchaseAddQty] = useState('');
  const [purchaseAddPrice, setPurchaseAddPrice] = useState('');
  const [purchaseAddCurrency, setPurchaseAddCurrency] = useState(
    editAsset?.currency || 'EUR'
  );
  const [alreadyOwned, setAlreadyOwned] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AssetSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  /** Today's price of the chosen symbol, in its quote currency. */
  const [marketQuote, setMarketQuote] = useState<{ price: number; currency: string } | null>(null);
  const searchSeqRef = useRef(0);

  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    const seq = ++searchSeqRef.current;
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      // A slower reply to an earlier keystroke must not replace newer results.
      if (seq !== searchSeqRef.current) return;
      if (!res.ok) {
        const msg =
          typeof data === 'object' && data && 'error' in data
            ? String((data as { error?: string }).error)
            : 'Search failed';
        setSearchResults([]);
        setError(msg);
        return;
      }
      const raw = Array.isArray(data) ? data : [];
      const cleaned = raw.filter(
        (row: { symbol?: unknown }) =>
          row &&
          typeof row.symbol === 'string' &&
          row.symbol.trim().length > 0
      ) as AssetSearchResult[];
      setSearchResults(cleaned);
      if (query.length >= 2) setError(null);
    } catch (e) {
      console.error("Search failed:", e);
      setSearchResults([]);
      setError('Search failed — check your connection and try again.');
    } finally {
      if (seq === searchSeqRef.current) setIsSearching(false);
    }
  };

  const selectAsset = (asset: AssetSearchResult) => {
    const hasPrice = typeof asset.price === 'number' && Number.isFinite(asset.price) && asset.price > 0;
    setMarketQuote(hasPrice ? { price: asset.price!, currency: asset.currency || formData.currency } : null);
    const displayName = asset.longName || asset.shortName || asset.name || asset.symbol;
    // Guess a cleaner display symbol (e.g. O instead of RY6.F)
    let displaySymbol = asset.symbol;
    if (displaySymbol.includes('.')) {
      displaySymbol = displaySymbol.split('.')[0];
    }
    
    setFormData(prev => ({
      ...prev,
      symbol: asset.symbol,
      displaySymbol: displaySymbol,
      name: displayName,
      currency: asset.currency || prev.currency,
      // Start from today's price; the user overwrites it with what they paid.
      averagePrice:
        prev.averagePrice.trim() === '' && hasPrice ? formatDecimalEn(asset.price!, 2) : prev.averagePrice,
      type: asset.quoteType?.toLowerCase().includes('etf') || asset.typeDisp?.toLowerCase().includes('etf') ? 'etf' : 
            asset.quoteType?.toLowerCase().includes('crypto') || asset.typeDisp?.toLowerCase().includes('crypto') ? 'crypto' : 'stock'
    }));
    setSearchResults([]);
    setSearchQuery('');
    setIsVerified(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const newAsset: Asset = {
      ...(editAsset?.id ? { id: editAsset.id } : {}),
      ...formData,
      quantity: parseShareInput(formData.quantity, 0),
      averagePrice: parseDecimalInput(formData.averagePrice, 0),
      updatedAt: new Date().toISOString()
    } as Asset;

    setIsSubmitting(true);
    setError(null);
    try {
      const opts: { flowAmountEur?: number; transferIn?: boolean } = {};
      // Flow amounts must be EUR. Without a rate, send no hint and let the server convert.
      if (!editAsset && alreadyOwned) {
        opts.transferIn = true;
      } else if (!editAsset) {
        const cost = newAsset.quantity * newAsset.averagePrice;
        const fx = fxToEur(newAsset.currency, exchangeRates);
        const flowAmountEur = cost * fx;
        if (fx > 0 && flowAmountEur > 0) opts.flowAmountEur = flowAmountEur;
      } else {
        const addQty = parseShareInput(purchaseAddQty, 0);
        const addPrice = parseDecimalInput(purchaseAddPrice, 0);
        if (addQty > 0 && purchaseAddPrice.trim() !== '') {
          const preview = mergeHoldingPurchase({
            quantity: parseShareInput(formData.quantity, 0),
            averagePrice: parseDecimalInput(formData.averagePrice, 0),
            holdingCurrency: formData.currency,
            addQuantity: addQty,
            addPricePerUnit: addPrice,
            addCurrency: purchaseAddCurrency,
            exchangeRates,
          });
          if ('error' in preview) {
            setError(preview.error);
            return;
          }
          // A filled-in purchase counts even if "Apply to holding" was not pressed.
          newAsset.quantity = preview.quantity;
          newAsset.averagePrice = preview.averagePrice;
          const holdingFx = fxToEur(formData.currency, exchangeRates);
          if (preview.totalCostBasisEur > 0 && holdingFx > 0) {
            const prevCostEur =
              parseShareInput(formData.quantity, 0) *
              parseDecimalInput(formData.averagePrice, 0) *
              holdingFx;
            const delta = preview.totalCostBasisEur - prevCostEur;
            if (Math.abs(delta) >= 0.01) opts.flowAmountEur = delta;
          }
        } else {
          // Direct edit of shares/average price: log the cost-basis change in EUR.
          const prevFx = fxToEur(editAsset.currency, exchangeRates);
          const nextFx = fxToEur(newAsset.currency, exchangeRates);
          if (prevFx > 0 && nextFx > 0) {
            const delta =
              newAsset.quantity * newAsset.averagePrice * nextFx -
              editAsset.quantity * editAsset.averagePrice * prevFx;
            if (Math.abs(delta) >= 0.01) opts.flowAmountEur = delta;
          }
        }
      }
      await onPersist(newAsset, Boolean(editAsset?.id), opts);
      if (!editAsset) playAssetAddedChime();
      onClose();
    } catch (err) {
      console.error("Submission failed:", err);
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Auto-fill label when symbol changes
  const checkSymbol = async (symbol: string) => {
    if (symbol.length < 2) return;
    setIsValidating(true);
    setIsVerified(false);
    try {
      const res = await fetch(`/api/quote/${symbol}`);
      const data = await res.json();
      if (data.name) {
        const price = typeof data.price === 'number' && data.price > 0 ? data.price : null;
        if (price != null) setMarketQuote({ price, currency: data.currency || formData.currency });
        setFormData(prev => ({
          ...prev,
          // Only auto-fill name if it is currently empty to prevent overwriting manual input
          name: prev.name === '' ? data.name : prev.name,
          currency: data.currency || prev.currency,
          averagePrice:
            !editAsset && prev.averagePrice.trim() === '' && price != null
              ? formatDecimalEn(price, 2)
              : prev.averagePrice,
        }));
        setIsVerified(true);
      } else {
        setIsVerified(false);
      }
    } catch (e) { 
      setIsVerified(false);
    } finally {
      setIsValidating(false);
    }
  };

  const purchasePreview = useMemo(() => {
    if (!editAsset) return null;
    const addQty = parseShareInput(purchaseAddQty, 0);
    if (!(addQty > 0) || purchaseAddPrice.trim() === '') return null;
    const addPrice = parseDecimalInput(purchaseAddPrice, 0);
    return mergeHoldingPurchase({
      quantity: parseShareInput(formData.quantity, 0),
      averagePrice: parseDecimalInput(formData.averagePrice, 0),
      holdingCurrency: formData.currency,
      addQuantity: addQty,
      addPricePerUnit: addPrice,
      addCurrency: purchaseAddCurrency,
      exchangeRates,
    });
  }, [
    editAsset,
    formData.quantity,
    formData.averagePrice,
    formData.currency,
    purchaseAddQty,
    purchaseAddPrice,
    purchaseAddCurrency,
    exchangeRates,
  ]);

  const handleApplyPurchase = () => {
    const addQty = parseShareInput(purchaseAddQty, 0);
    const addPrice = parseDecimalInput(purchaseAddPrice, 0);
    const result = mergeHoldingPurchase({
      quantity: parseShareInput(formData.quantity, 0),
      averagePrice: parseDecimalInput(formData.averagePrice, 0),
      holdingCurrency: formData.currency,
      addQuantity: addQty,
      addPricePerUnit: addPrice,
      addCurrency: purchaseAddCurrency,
      exchangeRates,
    });
    if ('error' in result) return;
    setFormData((f) => ({
      ...f,
      quantity: formatShares(result.quantity),
      averagePrice: formatDecimalEn(result.averagePrice, 2),
    }));
    setPurchaseAddQty('');
    setPurchaseAddPrice('');
  };

  const canApplyPurchase =
    purchasePreview != null && !('error' in purchasePreview);

  /** Adding a ticker that is already held: the server adds the shares to that holding. */
  const existingHolding = useMemo(() => {
    if (editAsset) return null;
    const sym = formData.symbol.trim().toUpperCase();
    if (!sym) return null;
    return existingAssets.find((a) => a.symbol?.trim().toUpperCase() === sym) ?? null;
  }, [editAsset, existingAssets, formData.symbol]);

  /** A new purchase far from today's price is usually an older buy entered without "already owned". */
  const costVsPrice = useMemo(() => {
    if (editAsset || alreadyOwned || !marketQuote) return null;
    const cost = parseDecimalInput(formData.averagePrice, NaN);
    if (!(cost > 0)) return null;
    const price = convertAmountBetweenCurrencies(
      marketQuote.price,
      marketQuote.currency,
      formData.currency,
      exchangeRates
    );
    if (price == null || !(price > 0)) return null;
    const diff = (cost - price) / price;
    return Math.abs(diff) >= COST_VS_PRICE_WARN_SHARE ? { diff, price } : null;
  }, [editAsset, alreadyOwned, marketQuote, formData.averagePrice, formData.currency, exchangeRates]);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-bg/95 backdrop-blur-xl z-50 flex items-center justify-center p-4"
    >
      <motion.div 
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        className="glass-panel p-10 w-full max-w-lg relative bg-card/50 border-accent/20 shadow-2xl flex flex-col max-h-[min(92vh,900px)] overflow-hidden"
      >
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-accent/50 to-transparent"></div>
        <button onClick={onClose} className="absolute top-6 right-6 p-2 text-text-s hover:text-text-p transition-colors rounded-full hover:bg-white/5">
          <X className="w-5 h-5" />
        </button>
        
        <h2 className="text-2xl font-semibold tracking-tighter mb-1 text-text-p">{editAsset ? 'Edit holding' : 'Add holding'}</h2>
        <p className="text-text-s mb-6 text-xs font-medium">{editAsset ? 'Change shares, price or currency' : 'Add a new asset to your portfolio'}</p>
        
        {!editAsset && (
        <div className="mb-6 space-y-2 relative">
          <label className="text-xs font-medium text-text-s px-1 ml-1">Find asset (name or ticker)</label>
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-s opacity-40" />
            <input 
              type="text"
              autoFocus
              className="w-full bg-bg border border-border focus:border-accent rounded-lg pl-12 pr-5 py-4 text-text-p focus:outline-none transition-all text-sm placeholder:opacity-20 shadow-inner"
              placeholder="e.g. S&P 500 or AAPL"
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
            />
            {isSearching && <RefreshCcw className="absolute right-4 top-1/2 -translate-y-1/2 w-3 h-3 animate-spin text-accent" />}
          </div>
          
          <AnimatePresence>
            {searchResults.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="absolute top-full left-0 w-full mt-2 bg-card border border-border rounded-lg shadow-2xl z-[60] max-h-72 overflow-y-auto p-2 space-y-1.5"
              >
                {searchResults.map((result, i) => (
                  <AssetSearchResultRow
                    key={`${result.symbol}-${i}`}
                    result={result}
                    onSelect={selectAsset}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto space-y-6 pr-1">
          {error && (
            <div className="p-4 bg-red/10 border border-red/20 rounded-lg text-red text-xs font-medium animate-pulse">
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <label className="text-xs font-medium text-text-s ml-1">Symbol (ticker)</label>
                {isValidating && <RefreshCcw className="w-2.5 h-2.5 animate-spin text-accent" />}
                {isVerified && <div className="text-xs font-semibold text-green tracking-tighter flex items-center gap-1"><Zap className="w-2.5 h-2.5" /> Verified</div>}
              </div>
              <input 
                required
                className={`w-full bg-bg/50 border ${isVerified ? 'border-green/30' : 'border-border'} focus:border-accent/50 rounded-lg px-5 py-4 text-text-p focus:outline-none transition-all font-mono text-sm placeholder:opacity-20`}
                placeholder="Ticker symbol"
                value={formData.symbol}
                onBlur={() => checkSymbol(formData.symbol)}
                onChange={e => setFormData({ ...formData, symbol: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center px-1">
                <label className="text-xs font-medium text-text-s ml-1">Display symbol</label>
              </div>
              <input 
                className="w-full bg-bg/50 border border-border focus:border-accent/50 rounded-lg px-5 py-4 text-text-p focus:outline-none transition-all font-mono text-sm placeholder:opacity-20"
                placeholder="Display symbol"
                value={formData.displaySymbol}
                onChange={e => setFormData({ ...formData, displaySymbol: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-text-s px-1 ml-1">Currency</label>
              <select 
                className="w-full bg-bg/50 border border-border focus:border-accent/50 rounded-lg px-5 py-4 text-text-p focus:outline-none transition-all text-sm appearance-none"
                value={formData.currency}
                onChange={e => setFormData({ ...formData, currency: e.target.value })}
              >
                {currencyOptionsWith(formData.currency).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-text-s px-1 ml-1">Name</label>
            <input 
              required
              className="w-full bg-bg/50 border border-border focus:border-accent/50 rounded-lg px-5 py-4 text-text-p focus:outline-none transition-all text-sm placeholder:opacity-20"
              placeholder="Instrument name"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          {editAsset && (
            <div className="rounded-lg border border-accent/25 bg-accent/5 overflow-hidden">
              <button
                type="button"
                onClick={() => setPurchaseExpanded((v) => !v)}
                className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-white/5 transition-colors"
              >
                <span className="text-xs font-semibold text-accent">
                  Add purchase
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-accent shrink-0 transition-transform ${purchaseExpanded ? 'rotate-180' : ''}`}
                />
              </button>
              {purchaseExpanded && (
                <div className="px-5 pb-5 space-y-4 border-t border-accent/15">
                  <p className="text-[11px] text-text-s font-mono pt-4">
                    Current:{' '}
                    <span className="text-text-p font-bold">
                      {formatShares(parseShareInput(formData.quantity, 0))}
                    </span>
                    {' @ '}
                    <span className="text-text-p font-bold">
                      {formatDecimalEn(parseDecimalInput(formData.averagePrice, 0), 2)}
                    </span>
                    {' '}
                    {formData.currency}
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-text-s px-1 ml-1">
                        Additional shares
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        className="w-full bg-bg/50 border border-border focus:border-accent/50 rounded-lg px-5 py-3 text-text-p focus:outline-none transition-all font-mono text-sm placeholder:opacity-20"
                        placeholder="0"
                        value={purchaseAddQty}
                        onChange={(e) => setPurchaseAddQty(sanitizeShareDraft(e.target.value))}
                        onBlur={() => setPurchaseAddQty((v) => formatShareInput(v))}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-text-s px-1 ml-1">
                        Price / unit ({purchaseAddCurrency})
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        className="w-full bg-bg/50 border border-border focus:border-accent/50 rounded-lg px-5 py-3 text-text-p focus:outline-none transition-all font-mono text-sm placeholder:opacity-20"
                        placeholder="0.00"
                        value={purchaseAddPrice}
                        onChange={(e) => setPurchaseAddPrice(e.target.value)}
                        onBlur={() =>
                          setPurchaseAddPrice((v) => formatDecimalInputEn(v, 2))
                        }
                      />
                    </div>
                    <div className="space-y-2 col-span-2">
                      <label className="text-xs font-medium text-text-s px-1 ml-1">
                        Purchase currency
                      </label>
                      <select
                        className="w-full bg-bg/50 border border-border focus:border-accent/50 rounded-lg px-5 py-3 text-text-p focus:outline-none transition-all text-sm appearance-none"
                        value={purchaseAddCurrency}
                        onChange={(e) => setPurchaseAddCurrency(e.target.value)}
                      >
                        {currencyOptionsWith(purchaseAddCurrency).map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {purchasePreview && 'error' in purchasePreview && (
                    <p className="text-xs text-red/90 font-medium">
                      {purchasePreview.error}
                    </p>
                  )}
                  {purchasePreview && !('error' in purchasePreview) && (
                    <div className="text-[11px] text-text-s space-y-1 font-mono leading-relaxed">
                      <p>
                        <span className="text-text-s/60 text-xs font-medium">
                          Preview
                        </span>
                        {' — '}
                        <span className="text-text-p font-bold">
                          {formatShares(purchasePreview.quantity)}
                        </span>{' '}
                        shares · avg{' '}
                        <span className="text-text-p font-bold">
                          {formatDecimalEn(purchasePreview.averagePrice, 2)}
                        </span>{' '}
                        {formData.currency}
                      </p>
                      <p>
                        Cost basis{' '}
                        {formatCurrency(purchasePreview.totalCostBasis, formData.currency)}
                        {formData.currency.toUpperCase() !== 'EUR' && (
                          <>
                            {' · '}
                            {formatCurrency(purchasePreview.totalCostBasisEur, 'EUR')}
                          </>
                        )}
                      </p>
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={!canApplyPurchase}
                    onClick={handleApplyPurchase}
                    className="w-full py-3 bg-white/10 hover:bg-white/15 disabled:opacity-40 border border-border rounded-lg text-xs font-semibold text-text-p transition-all"
                  >
                    Apply to holding
                  </button>
                </div>
              )}
            </div>
          )}
          
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-medium text-text-s px-1 ml-1">Quantity</label>
              <input 
                required
                type="text"
                inputMode="numeric"
                className="w-full bg-bg/50 border border-border focus:border-accent/50 rounded-lg px-5 py-4 text-text-p focus:outline-none transition-all font-mono text-sm placeholder:opacity-20"
                placeholder="0"
                value={formData.quantity}
                onChange={e => setFormData({ ...formData, quantity: sanitizeShareDraft(e.target.value) })}
                onBlur={() =>
                  setFormData((f) => ({
                    ...f,
                    quantity: formatShareInput(f.quantity),
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-text-s px-1 ml-1">
                Cost per unit ({formData.currency || 'EUR'})
              </label>
              <EurAmountInput
                required
                currency={formData.currency}
                className="py-4 text-sm transition-all placeholder:opacity-20"
                placeholder="0.00"
                value={formData.averagePrice}
                onChange={(e) => setFormData({ ...formData, averagePrice: e.target.value })}
                onBlur={() =>
                  setFormData((f) => ({
                    ...f,
                    averagePrice: formatDecimalInputEn(f.averagePrice, 2),
                  }))
                }
              />
            </div>
          </div>
          {existingHolding && (
            <p className="rounded-lg border border-accent/25 bg-accent/5 px-4 py-3 text-[11px] leading-relaxed text-text-s">
              <span className="block font-bold text-text-p">
                You already hold {formatShares(Number(existingHolding.quantity) || 0)} {existingHolding.displaySymbol || existingHolding.symbol}
              </span>
              These shares are added to that holding and its average cost is updated, instead of a second row.
            </p>
          )}
          {costVsPrice && (
            <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-[11px] leading-relaxed text-text-s">
              <span className="block font-bold text-text-p">
                Cost is {formatPercentEn(Math.abs(costVsPrice.diff) * 100, 0)}{' '}
                {costVsPrice.diff < 0 ? 'below' : 'above'} today&rsquo;s price ({formatCurrency(costVsPrice.price, formData.currency)})
              </span>
              If you bought these before today, tick &ldquo;I already owned this&rdquo; below, or the whole gap is
              counted as today&rsquo;s gain or loss.
            </p>
          )}
          </div>

          {!editAsset ? (
            <label className="flex items-start gap-3 mt-6 rounded-lg border border-border/50 bg-bg/30 px-4 py-3 cursor-pointer select-none">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                checked={alreadyOwned}
                onChange={(e) => setAlreadyOwned(e.target.checked)}
              />
              <span className="text-[11px] leading-relaxed text-text-s">
                <span className="block font-bold text-text-p">I already owned this before today</span>
                Counts it at today&rsquo;s market value instead of as a new purchase, so its past gain or
                loss isn&rsquo;t shown as today&rsquo;s or this period&rsquo;s return.
              </span>
            </label>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full shrink-0 py-5 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white font-semibold text-xs rounded-lg transition-all shadow-xl shadow-accent/20 active:scale-[0.98] mt-4 flex items-center justify-center gap-3"
          >
            {isSubmitting ? (
              <RefreshCcw className="w-4 h-4 animate-spin" />
            ) : (
              editAsset ? 'Save changes' : existingHolding ? 'Add to holding' : 'Add to portfolio'
            )}
          </button>
        </form>
      </motion.div>
    </motion.div>
  );
};
