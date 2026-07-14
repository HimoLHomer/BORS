import React from 'react';
import { motion } from 'motion/react';

export type DataListColumn = {
  key: string;
  label: React.ReactNode;
  align?: 'left' | 'right';
  headerClassName?: string;
  cellClassName?: string;
  /** Fixed column width for table-fixed layouts (e.g. `6.5rem`, `12%`). */
  width?: string;
};

export function dataListRowClassName(rowIndex: number, highlight?: boolean): string {
  if (highlight) return 'group bg-accent/10 outline outline-1 outline-accent/40 rounded-lg';
  return rowIndex % 2 === 0
    ? 'group bg-bg/30 rounded-lg'
    : 'group bg-bg/15 rounded-lg';
}

export function dataListCellClassName(align: 'left' | 'right' = 'left', extra?: string): string {
  const base = align === 'right' ? 'text-right text-text-p' : 'text-left text-text-s/90';
  return `px-3 py-2 tabular-nums ${base}${extra ? ` ${extra}` : ''}`;
}

export function DataListTable({
  columns,
  rows,
  minWidth = 720,
  horizontalScroll = true,
  highlightWhen,
  rowClassName,
  emptyState,
  showHeader = true,
  onRowClick,
  tableClassName,
  headerRowClassName,
  enterStaggerKey,
  enterStaggerMax = 12,
  rowKeys,
}: {
  columns: DataListColumn[];
  rows: Record<string, React.ReactNode>[];
  minWidth?: number;
  /** When false, table fits the container width (no nested horizontal scrollbar). */
  horizontalScroll?: boolean;
  highlightWhen?: (rowIndex: number) => boolean;
  rowClassName?: (rowIndex: number) => string | undefined;
  emptyState?: React.ReactNode;
  showHeader?: boolean;
  onRowClick?: (rowIndex: number) => void;
  tableClassName?: string;
  headerRowClassName?: string;
  /** When set, rows fade in with stagger on key change (e.g. dashboard open). */
  enterStaggerKey?: number;
  enterStaggerMax?: number;
  rowKeys?: string[];
}) {
  const colSpan = columns.length;

  return (
    <div
      className={
        horizontalScroll
          ? 'overflow-x-auto -mx-2 px-2'
          : 'min-w-0 -mx-2 px-2 overflow-x-hidden'
      }
    >
      <table
        className={`w-full border-separate border-spacing-y-1 text-xs font-mono${tableClassName ? ` ${tableClassName}` : ''}`}
        style={horizontalScroll && minWidth > 0 ? { minWidth } : undefined}
      >
        {columns.some((c) => c.width) ? (
          <colgroup>
            {columns.map((c) => (
              <col key={c.key} style={c.width ? { width: c.width } : undefined} />
            ))}
          </colgroup>
        ) : null}
        {showHeader ? (
          <thead>
            <tr
              className={
                headerRowClassName ??
                'text-[9px] font-bold text-text-s uppercase tracking-[0.2em] opacity-50'
              }
            >
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`px-3 py-2 whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'} ${c.headerClassName ?? ''}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody className="font-bold">
          {rows.length === 0 && emptyState != null ? (
            <tr className="bg-bg/30 rounded-lg">
              <td colSpan={colSpan} className="px-3 py-12 text-center">
                {emptyState}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => {
              const rowClass = [
                rowClassName?.(i) ?? dataListRowClassName(i, highlightWhen?.(i)),
                onRowClick ? 'cursor-pointer hover:outline hover:outline-1 hover:outline-green/30' : '',
              ]
                .filter(Boolean)
                .join(' ');

              const cells = columns.map((c) => (
                <td
                  key={c.key}
                  className={c.cellClassName ?? dataListCellClassName(c.align ?? 'left')}
                >
                  {row[c.key]}
                </td>
              ));

              const rowKey = rowKeys?.[i] ?? String(i);

              if (enterStaggerKey != null) {
                const staggered = i < enterStaggerMax;
                return (
                  <motion.tr
                    key={`${enterStaggerKey}-${rowKey}`}
                    className={rowClass}
                    initial={staggered ? { opacity: 0, y: 6 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={
                      staggered
                        ? { delay: i * 0.04, duration: 0.22, ease: [0.22, 1, 0.36, 1] as const }
                        : { duration: 0 }
                    }
                    onClick={onRowClick ? () => onRowClick(i) : undefined}
                  >
                    {cells}
                  </motion.tr>
                );
              }

              return (
                <tr
                  key={rowKey}
                  className={rowClass}
                  onClick={onRowClick ? () => onRowClick(i) : undefined}
                >
                  {cells}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
