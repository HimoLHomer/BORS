import React, { useState } from 'react';
import { X } from 'lucide-react';
import { motion } from 'motion/react';
import type { HistoryPoint } from './types';
import { formatDecimalEn, formatDecimalInputEn, parseDecimalInput } from './formatNumber';
import { todayIsoDateHelsinki } from './formatDate';
import { EurAmountInput } from './EurAmountField';
import { ThemeDatePicker } from './ThemeDatePicker';

export const HistoryPointModal = ({
  modal,
  onClose,
  onSaved,
}: {
  modal: { type: 'edit'; point: HistoryPoint } | { type: 'add' };
  onClose: () => void;
  onSaved: () => Promise<void>;
}) => {
  const [dateStr, setDateStr] = useState(
    modal.type === 'edit' ? modal.point.date : todayIsoDateHelsinki()
  );
  const [valueStr, setValueStr] = useState(
    modal.type === 'edit' ? formatDecimalEn(modal.point.value, 2) : ''
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    const val = parseDecimalInput(valueStr, NaN);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      setErr('Use date format YYYY-MM-DD');
      return;
    }
    if (!Number.isFinite(val)) {
      setErr('Enter a valid number');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/portfolio/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: dateStr, value: val }),
      });
      if (!res.ok) throw new Error('Save failed');
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (modal.type !== 'edit') return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/portfolio/history/${encodeURIComponent(modal.point.date)}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) throw new Error('Delete failed');
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete');
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-bg/95 backdrop-blur-xl z-[60] flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 12 }}
        className="glass-panel p-8 w-full max-w-md border-border bg-card/80 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-black uppercase tracking-tight text-text-p">
            {modal.type === 'edit' ? 'Edit history row' : 'Add history row'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-text-s hover:text-text-p hover:bg-white/5"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-[9px] font-bold text-text-s uppercase tracking-widest block mb-2">Date</label>
            <ThemeDatePicker
              value={dateStr}
              onChange={setDateStr}
              disabled={modal.type === 'edit'}
            />
            {modal.type === 'edit' && (
              <p className="text-[9px] text-text-s mt-1.5 opacity-70">Date cannot be changed; delete and re-add if needed.</p>
            )}
          </div>
          <div>
            <label className="text-[9px] font-bold text-text-s uppercase tracking-widest block mb-2">
              Total portfolio value (EUR)
            </label>
            <EurAmountInput
              placeholder="e.g. 125,000.50"
              value={valueStr}
              onChange={(e) => setValueStr(e.target.value)}
              onBlur={() => setValueStr((v) => formatDecimalInputEn(v, 2))}
            />
          </div>
          {err && (
            <p className="text-[10px] text-red font-bold uppercase tracking-widest">{err}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-3 mt-8">
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="flex-1 min-w-[120px] py-3 bg-accent text-white rounded-xl font-black uppercase tracking-widest text-[10px] disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          {modal.type === 'edit' && modal.point.id !== '__bors_live_today__' && (
            <button
              type="button"
              disabled={busy}
              onClick={remove}
              className="px-4 py-3 rounded-xl border border-red/40 text-red font-black uppercase tracking-widest text-[10px] hover:bg-red/10 disabled:opacity-50"
            >
              Delete
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};
