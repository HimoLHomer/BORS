import React from 'react';
import { motion } from 'motion/react';
import { dataListRowClassName } from './DataListTable';

type HoldingsDetailRow = Record<string, React.ReactNode>;

export function HoldingsDetailTable({
  rows,
  emptyState,
  enterStaggerKey,
  enterStaggerMax = 12,
  rowKeys,
}: {
  rows: HoldingsDetailRow[];
  emptyState?: React.ReactNode;
  /** When set, rows fade in with stagger on key change (e.g. dividends view open). */
  enterStaggerKey?: number;
  enterStaggerMax?: number;
  rowKeys?: string[];
}) {
  return (
    <div className="-mx-2 px-2 text-xs font-mono">
      <div className="holdings-detail-grid px-2 py-2 text-[9px] font-bold text-text-s uppercase tracking-wide opacity-50">
        <div>Asset</div>
        <div className="text-right">Est. income</div>
        <div className="text-right">Yield</div>
        <div className="text-right">Per share</div>
        <div className="text-right">Freq.</div>
        <div aria-hidden />
        <div className="text-right pr-0">Dividend info</div>
      </div>

      <div className="space-y-1">
        {rows.length === 0 && emptyState != null ? (
          <div className="rounded-lg bg-bg/30 px-3 py-12 text-center">{emptyState}</div>
        ) : (
          rows.map((row, i) => {
            const rowClass = `holdings-detail-grid px-2 py-2 font-bold ${dataListRowClassName(i)}`;
            const rowKey = rowKeys?.[i] ?? String(i);
            const content = (
              <>
                <div className="min-w-0">{row.asset}</div>
                <div className="text-right text-text-p tabular-nums whitespace-nowrap">{row.income}</div>
                <div className="text-right text-text-p tabular-nums whitespace-nowrap">{row.yield}</div>
                <div className="text-right text-text-s/50 tabular-nums whitespace-nowrap">
                  {row.annualShare}
                </div>
                <div className="text-right text-text-s/50 whitespace-nowrap">{row.freq}</div>
                <div className="text-right">{row.actions}</div>
                <div className="min-w-0 flex justify-end">{row.infoLink}</div>
              </>
            );

            if (enterStaggerKey != null) {
              const staggered = i < enterStaggerMax;
              return (
                <motion.div
                  key={`${enterStaggerKey}-${rowKey}`}
                  className={rowClass}
                  initial={staggered ? { opacity: 0, y: 6 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={
                    staggered
                      ? { delay: i * 0.04, duration: 0.22, ease: [0.22, 1, 0.36, 1] as const }
                      : { duration: 0 }
                  }
                >
                  {content}
                </motion.div>
              );
            }

            return (
              <div key={rowKey} className={rowClass}>
                {content}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
