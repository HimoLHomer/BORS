import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { Asset } from './types';
import { displayTickerForAsset } from './assetLogo';
import { formatDecimalInputFi, formatShares, parseDecimalInput } from './formatNumber';
import { EurAmountInput } from './EurAmountField';
import { MARKET_SUBCARD } from './marketTheme';
import { ThemeDatePicker } from './ThemeDatePicker';
import type { DividendPayoutFrequency } from './manualDividends';

function holdingShareCount(asset: Asset): string | null {
  if (!Number.isFinite(asset.quantity) || asset.quantity <= 0) return null;
  return formatShares(asset.quantity);
}

function HoldingPickerRow({
  asset,
  selected,
  onSelect,
}: {
  asset: Asset;
  selected: boolean;
  onSelect: () => void;
}) {
  const ticker = displayTickerForAsset(asset);
  const shares = holdingShareCount(asset);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`${MARKET_SUBCARD} w-full p-3 text-left font-sans transition-colors hover:bg-bg/40 hover:border-accent/25 ${
        selected ? 'border-accent/40 bg-accent/5' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-p truncate">{asset.name}</div>
          <div className="mt-0.5 text-xs text-text-s/75 truncate tabular-nums">{ticker}</div>
        </div>
        {shares ? (
          <span
            className="shrink-0 inline-flex items-center rounded-md border border-border/50 bg-white/5 px-2 py-0.5 leading-none"
            title={`${shares} shares`}
          >
            <span className="text-[10px] font-semibold tabular-nums text-text-p">{shares}</span>
          </span>
        ) : null}
      </div>
    </button>
  );
}

function HoldingPickerTrigger({ asset }: { asset: Asset }) {
  const ticker = displayTickerForAsset(asset);
  const shares = holdingShareCount(asset);

  return (
    <div className="flex items-start justify-between gap-3 min-w-0 flex-1">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text-p truncate">{asset.name}</div>
        <div className="mt-0.5 text-xs text-text-s/75 truncate tabular-nums">{ticker}</div>
      </div>
      {shares ? (
        <span
          className="shrink-0 inline-flex items-center rounded-md border border-border/50 bg-white/5 px-2 py-0.5 leading-none"
          title={`${shares} shares`}
        >
          <span className="text-[10px] font-semibold tabular-nums text-text-p">{shares}</span>
        </span>
      ) : null}
    </div>
  );
}

export type ManualDividendModalProps = {
  open: boolean;
  editing: boolean;
  eligibleHoldings: Asset[];
  allAssets: Asset[];
  draftLinkedSymbol: string;
  draftAnnual: string;
  draftFrequency: DividendPayoutFrequency;
  draftPayoutDate: string;
  saveError: string | null;
  onClose: () => void;
  onSave: () => void;
  onDraftLinkedSymbolChange: (symbol: string) => void;
  onDraftAnnualChange: (value: string) => void;
  onDraftFrequencyChange: (value: DividendPayoutFrequency) => void;
  onDraftPayoutDateChange: (value: string) => void;
  onClearSaveError: () => void;
};

export function ManualDividendModal({
  open,
  editing,
  eligibleHoldings,
  allAssets,
  draftLinkedSymbol,
  draftAnnual,
  draftFrequency,
  draftPayoutDate,
  saveError,
  onClose,
  onSave,
  onDraftLinkedSymbolChange,
  onDraftAnnualChange,
  onDraftFrequencyChange,
  onDraftPayoutDateChange,
  onClearSaveError,
}: ManualDividendModalProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');

  const selectedAsset = useMemo(
    () => allAssets.find((a) => a.symbol === draftLinkedSymbol) ?? null,
    [allAssets, draftLinkedSymbol]
  );

  const filteredHoldings = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    const base = eligibleHoldings.filter((a) => a.symbol !== draftLinkedSymbol);
    if (!q) return base;
    return base.filter((a) => {
      const ticker = displayTickerForAsset(a).toLowerCase();
      return a.name.toLowerCase().includes(q) || ticker.includes(q) || a.symbol.toLowerCase().includes(q);
    });
  }, [eligibleHoldings, filterQuery, draftLinkedSymbol]);

  const annualParsed = parseDecimalInput(draftAnnual, 0);
  const canSave =
    draftLinkedSymbol.trim() !== '' &&
    Number.isFinite(annualParsed) &&
    annualParsed > 0;

  useEffect(() => {
    if (!open) {
      setPickerOpen(false);
      setFilterQuery('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setPickerOpen(false);
    setFilterQuery('');
    onClearSaveError();
  }, [draftLinkedSymbol, open, onClearSaveError]);

  const showFilter = eligibleHoldings.length > 8;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-bg/95 backdrop-blur-xl z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        className="glass-panel p-10 w-full max-w-lg relative bg-card/50 border-accent/20 shadow-2xl flex flex-col max-h-[min(92vh,900px)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-accent/50 to-transparent" />
        <button
          type="button"
          onClick={onClose}
          className="absolute top-6 right-6 p-2 text-text-s hover:text-text-p transition-colors rounded-full hover:bg-white/5"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-2xl font-black tracking-tighter mb-1 text-text-p uppercase">
          {editing ? 'Edit dividend estimate' : 'Add dividend estimate'}
        </h2>
        <p className="text-text-s mb-8 text-[10px] uppercase tracking-[0.25em] font-bold opacity-60">
          Manual estimate for holdings without feed data
        </p>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-8 pr-1">
          <div className="space-y-2">
            <label className="text-[9px] font-bold text-text-s uppercase tracking-widest px-1 ml-1">
              Holding
            </label>

            {eligibleHoldings.length === 0 ? (
              <p className="text-xs text-text-s/70 px-1 leading-relaxed">
                All holdings already have dividend data from the feed or an existing estimate.
              </p>
            ) : (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setPickerOpen((v) => !v)}
                  className={`${MARKET_SUBCARD} w-full p-3 text-left font-sans transition-colors hover:bg-bg/40 hover:border-accent/25 flex items-center gap-2 min-w-0`}
                >
                  {selectedAsset ? (
                    <HoldingPickerTrigger asset={selectedAsset} />
                  ) : (
                    <span className="text-sm text-text-s/60 flex-1">Select a holding…</span>
                  )}
                  <ChevronDown
                    className={`w-4 h-4 shrink-0 text-text-s/50 transition-transform ${pickerOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                <AnimatePresence>
                  {pickerOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="absolute top-full left-0 w-full mt-2 bg-card border border-border rounded-xl shadow-2xl z-[60] overflow-hidden"
                    >
                      {showFilter && (
                        <div className="p-2 border-b border-border/40">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-s/40" />
                            <input
                              type="text"
                              value={filterQuery}
                              onChange={(e) => setFilterQuery(e.target.value)}
                              placeholder="Filter holdings…"
                              className="w-full bg-bg/50 border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-text-p focus:outline-none focus:border-accent/50 placeholder:opacity-40"
                            />
                          </div>
                        </div>
                      )}
                      <div className="max-h-48 overflow-y-auto p-2 space-y-1.5">
                        {filteredHoldings.length === 0 ? (
                          <p className="text-xs text-text-s/60 px-2 py-3 text-center">
                            {filterQuery.trim() ? 'No matching holdings' : 'No other holdings'}
                          </p>
                        ) : (
                          filteredHoldings.map((a) => (
                            <HoldingPickerRow
                              key={a.id ?? `${a.symbol}-${a.name}`}
                              asset={a}
                              selected={false}
                              onSelect={() => {
                                onDraftLinkedSymbolChange(a.symbol);
                                setPickerOpen(false);
                                setFilterQuery('');
                              }}
                            />
                          ))
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-[9px] font-bold text-text-s uppercase tracking-widest px-1 ml-1">
              Annual dividend income (EUR)
            </label>
            <EurAmountInput
              value={draftAnnual}
              onChange={(e) => {
                onDraftAnnualChange(e.target.value);
                onClearSaveError();
              }}
              onBlur={() => onDraftAnnualChange(formatDecimalInputFi(draftAnnual, 2))}
              className="py-4 text-sm"
              placeholder="0,00"
            />
            <p className="text-xs text-text-s/60 px-1 leading-relaxed">
              Yield uses this holding&apos;s EUR value on the Dashboard.
            </p>
            {draftAnnual.trim() !== '' && annualParsed <= 0 && (
              <p className="text-xs text-amber/80 px-1">Enter annual dividend income in EUR.</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[9px] font-bold text-text-s uppercase tracking-widest px-1 ml-1">
                Payout frequency
              </label>
              <select
                value={draftFrequency}
                onChange={(e) => onDraftFrequencyChange(e.target.value as DividendPayoutFrequency)}
                className="w-full bg-bg/50 border border-border focus:border-accent/50 rounded-xl px-5 py-4 text-text-p focus:outline-none transition-all text-sm appearance-none"
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[9px] font-bold text-text-s uppercase tracking-widest px-1 ml-1">
                First pay date (optional)
              </label>
              <ThemeDatePicker
                value={draftPayoutDate}
                onChange={onDraftPayoutDateChange}
                placeholder="Select date…"
              />
            </div>
          </div>

          {saveError && (
            <div className="p-4 bg-amber/10 border border-amber/20 rounded-xl text-amber text-xs leading-relaxed">
              {saveError}
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-3 pt-8 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-border/60 text-[10px] font-black uppercase tracking-widest text-text-p"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave || eligibleHoldings.length === 0}
            className="px-4 py-2.5 rounded-lg bg-accent text-white text-[10px] font-black uppercase tracking-widest shadow-lg shadow-accent/20 hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            Save
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
