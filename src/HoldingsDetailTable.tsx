import React from 'react';
import { dataListRowClassName } from './DataListTable';

type HoldingsDetailRow = Record<string, React.ReactNode>;

export function HoldingsDetailTable({
  rows,
  emptyState,
}: {
  rows: HoldingsDetailRow[];
  emptyState?: React.ReactNode;
}) {
  return (
    <div className="-mx-2 px-2 text-xs font-mono">
      <div className="holdings-detail-grid px-2 py-2 text-[9px] font-bold text-text-s uppercase tracking-wide opacity-50">
        <div>Asset</div>
        <div className="text-right">Yield</div>
        <div className="text-right">Per share</div>
        <div className="text-right">Est. income</div>
        <div className="text-right">Freq.</div>
        <div aria-hidden />
        <div className="text-right pr-0">Dividend info</div>
      </div>

      <div className="space-y-1">
        {rows.length === 0 && emptyState != null ? (
          <div className="rounded-lg bg-bg/30 px-3 py-12 text-center">{emptyState}</div>
        ) : (
          rows.map((row, i) => (
            <div
              key={i}
              className={`holdings-detail-grid px-2 py-2 font-bold ${dataListRowClassName(i)}`}
            >
              <div className="min-w-0">{row.asset}</div>
              <div className="text-right text-text-p tabular-nums whitespace-nowrap">{row.yield}</div>
              <div className="text-right text-text-s/50 tabular-nums whitespace-nowrap">
                {row.annualShare}
              </div>
              <div className="text-right text-text-p tabular-nums whitespace-nowrap">{row.income}</div>
              <div className="text-right text-text-s/50 whitespace-nowrap">{row.freq}</div>
              <div className="text-right">{row.actions}</div>
              <div className="min-w-0 flex justify-end">{row.infoLink}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
