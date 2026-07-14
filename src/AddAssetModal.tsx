import React, { useState, useMemo } from 'react';
import { X, Search, RefreshCcw, Zap, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { Asset } from './types';
import { formatCurrency, fxToEur } from './formatCurrency';
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
            <span className="text-[8px] font-bold uppercase tracking-widest text-green/70">Div</span>
            <span className="text-[10px] font-semibold tabular-nums text-green">
              {formatPercentEn(yieldPct, 2)}
            </span>
          </span>
        ) : null}
      </div>
    </button>
  );
}

export const AddAssetModal = ({ onClose, onPersist, editAsset, exchangeRates }: {
  onClose: () => void, 
  onPersist: (
    asset: Asset,
    isEdit: boolean,
    opts?: { flowAmountEur?: number }
  ) => Promise<void>,
  editAsset?: Asset,
  exchangeRates: Record<string, number>,
}) => {
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AssetSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
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
      setIsSearching(false);
    }
  };

  const selectAsset = (asset: AssetSearchResult) => {
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
      const opts: { flowAmountEur?: number } = {};
      if (!editAsset) {
        const cost = newAsset.quantity * newAsset.averagePrice;
        const fx = fxToEur(newAsset.currency, exchangeRates) || 1;
        const flowAmountEur = cost * fx;
        if (flowAmountEur > 0) opts.flowAmountEur = flowAmountEur;
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
          if (!('error' in preview) && preview.totalCostBasisEur > 0) {
            const prevCostEur =
              parseShareInput(formData.quantity, 0) *
              parseDecimalInput(formData.averagePrice, 0) *
              (fxToEur(formData.currency, exchangeRates) || 1);
            const delta = preview.totalCostBasisEur - prevCostEur;
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
        setFormData(prev => ({ 
          ...prev, 
          // Only auto-fill name if it is currently empty to prevent overwriting manual input
          name: prev.name === '' ? data.name : prev.name, 
          currency: data.currency || prev.currency 
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
        
        <h2 className="text-2xl font-black tracking-tighter mb-1 text-text-p uppercase">{editAsset ? 'Edit Holding' : 'Add New Holding'}</h2>
        <p className="text-text-s mb-8 text-[10px] uppercase tracking-[0.25em] font-bold opacity-60">{editAsset ? 'Modify existing asset vector' : 'Add a new asset to your portfolio'}</p>
        
        {!editAsset && (
        <div className="mb-8 space-y-2 relative">
          <label className="text-[9px] font-bold text-text-s uppercase tracking-widest px-1 ml-1">Find Asset (Name or Ticker)</label>
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-s opacity-40" />
            <input 
              type="text"
              className="w-full bg-bg border border-border focus:border-accent rounded-xl pl-12 pr-5 py-4 text-text-p focus:outline-none transition-all text-sm placeholder:opacity-20 shadow-inner"
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
                className="absolute top-full left-0 w-full mt-2 bg-card border border-border rounded-xl shadow-2xl z-[60] max-h-72 overflow-y-auto p-2 space-y-1.5"
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
          <div className="flex-1 min-h-0 overflow-y-auto space-y-8 pr-1">
          {error && (
            <div className="p-4 bg-red/10 border border-red/20 rounded-xl text-red text-[10px] uppercase font-bold tracking-widest animate-pulse">
              System Error: {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <label className="text-[9px] font-bold text-text-s uppercase tracking-widest ml-1">Symbol (Ticker)</label>
                {isValidating && <RefreshCcw className="w-2.5 h-2.5 animate-spin text-accent" />}
                {isVerified && <div className="text-[8px] font-black text-green tracking-tighter uppercase flex items-center gap-1"><Zap className="w-2.5 h-2.5" /> Verified</div>}
              </div>
              <input 
                required
                autoFocus
                className={`w-full bg-bg/50 border ${isVerified ? 'border-green/30' : 'border-border'} focus:border-accent/50 rounded-xl px-5 py-4 text-text-p focus:outline-none transition-all font-mono text-sm placeholder:opacity-20`}
                placeholder="Ticker symbol"
                value={formData.symbol}
                onBlur={() => checkSymbol(formData.symbol)}
                onChange={e => setFormData({ ...formData, symbol: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[9px] font-bold text-text-s uppercase tracking-widest px-1 ml-1 text-accent">Display Symbol (Visual)</label>
              <input 
                className="w-full bg-bg/50 border border-border focus:border-accent/50 rounded-xl px-5 py-4 text-text-p focus:outline-none transition-all font-mono text-sm placeholder:opacity-20"
                placeholder="Display symbol"
                value={formData.displaySymbol}
                onChange={e => setFormData({ ...formData, displaySymbol: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[9px] font-bold text-text-s uppercase tracking-widest px-1 ml-1">Currency</label>
              <select 
                className="w-full bg-bg/50 border border-border focus:border-accent/50 rounded-xl px-5 py-4 text-text-p focus:outline-none transition-all text-sm appearance-none"
                value={formData.currency}
                onChange={e => setFormData({ ...formData, currency: e.target.value })}
              >
                <option value="EUR">EUR (€)</option>
                <option value="USD">USD ($)</option>
                <option value="GBP">GBP (£)</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[9px] font-bold text-text-s uppercase tracking-widest px-1 ml-1">Asset Label</label>
            <input 
              required
              className="w-full bg-bg/50 border border-border focus:border-accent/50 rounded-xl px-5 py-4 text-text-p focus:outline-none transition-all text-sm placeholder:opacity-20"
              placeholder="Instrument name"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          {editAsset && (
            <div className="rounded-xl border border-accent/25 bg-accent/5 overflow-hidden">
              <button
                type="button"
                onClick={() => setPurchaseExpanded((v) => !v)}
                className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-white/5 transition-colors"
              >
                <span className="text-[10px] font-black text-accent uppercase tracking-[0.2em]">
                  Add purchase
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-accent shrink-0 transition-transform ${purchaseExpanded ? 'rotate-180' : ''}`}
                />
              </button>
              {purchaseExpanded && (
                <div className="px-5 pb-5 space-y-4 border-t border-accent/15">
                  <p className="text-[10px] text-text-s font-mono pt-4">
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
                      <label className="text-[9px] font-bold text-text-s uppercase tracking-widest px-1 ml-1">
                        Additional shares
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        className="w-full bg-bg/50 border border-border focus:border-accent/50 rounded-xl px-5 py-3 text-text-p focus:outline-none transition-all font-mono text-sm placeholder:opacity-20"
                        placeholder="0"
                        value={purchaseAddQty}
                        onChange={(e) => setPurchaseAddQty(sanitizeShareDraft(e.target.value))}
                        onBlur={() => setPurchaseAddQty((v) => formatShareInput(v))}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[9px] font-bold text-text-s uppercase tracking-widest px-1 ml-1">
                        Price / unit ({purchaseAddCurrency})
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        className="w-full bg-bg/50 border border-border focus:border-accent/50 rounded-xl px-5 py-3 text-text-p focus:outline-none transition-all font-mono text-sm placeholder:opacity-20"
                        placeholder="0.00"
                        value={purchaseAddPrice}
                        onChange={(e) => setPurchaseAddPrice(e.target.value)}
                        onBlur={() =>
                          setPurchaseAddPrice((v) => formatDecimalInputEn(v, 2))
                        }
                      />
                    </div>
                    <div className="space-y-2 col-span-2">
                      <label className="text-[9px] font-bold text-text-s uppercase tracking-widest px-1 ml-1">
                        Purchase currency
                      </label>
                      <select
                        className="w-full bg-bg/50 border border-border focus:border-accent/50 rounded-xl px-5 py-3 text-text-p focus:outline-none transition-all text-sm appearance-none"
                        value={purchaseAddCurrency}
                        onChange={(e) => setPurchaseAddCurrency(e.target.value)}
                      >
                        <option value="EUR">EUR (€)</option>
                        <option value="USD">USD ($)</option>
                        <option value="GBP">GBP (£)</option>
                      </select>
                    </div>
                  </div>
                  {purchasePreview && 'error' in purchasePreview && (
                    <p className="text-[10px] text-red/90 font-bold uppercase tracking-widest">
                      {purchasePreview.error}
                    </p>
                  )}
                  {purchasePreview && !('error' in purchasePreview) && (
                    <div className="text-[10px] text-text-s space-y-1 font-mono leading-relaxed">
                      <p>
                        <span className="text-text-s/60 uppercase tracking-widest text-[9px] font-bold">
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
                    className="w-full py-3 bg-white/10 hover:bg-white/15 disabled:opacity-40 border border-border rounded-xl text-[10px] font-black uppercase tracking-[0.2em] text-text-p transition-all"
                  >
                    Apply to holding
                  </button>
                </div>
              )}
            </div>
          )}
          
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[9px] font-bold text-text-s uppercase tracking-widest px-1 ml-1">Quantity (Units)</label>
              <input 
                required
                type="text"
                inputMode="numeric"
                className="w-full bg-bg/50 border border-border focus:border-accent/50 rounded-xl px-5 py-4 text-text-p focus:outline-none transition-all font-mono text-sm placeholder:opacity-20"
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
              <label className="text-[9px] font-bold text-text-s uppercase tracking-widest px-1 ml-1">Cost Per Unit</label>
              <EurAmountInput
                required
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
          </div>

          <button 
            type="submit"
            disabled={isSubmitting}
            className="w-full shrink-0 py-5 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white font-black uppercase tracking-[0.2em] text-[11px] rounded-xl transition-all shadow-xl shadow-accent/20 active:scale-[0.98] mt-4 flex items-center justify-center gap-3"
          >
            {isSubmitting ? (
              <RefreshCcw className="w-4 h-4 animate-spin" />
            ) : (
              editAsset ? 'Save Changes' : 'Add to Portfolio'
            )}
          </button>
        </form>
      </motion.div>
    </motion.div>
  );
};
