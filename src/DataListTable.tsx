import React from 'react';
import { motion } from 'motion/react';
import { ArrowDown, ArrowUp } from 'lucide-react';

export type DataListColumn = {
  key: string;
  label: React.ReactNode;
  align?: 'left' | 'right';
  headerClassName?: string;
  cellClassName?: string;
  /** Fixed column width for table-fixed layouts (e.g. `6.5rem`, `12%`). */
  width?: string;
  /** Header becomes a button that sorts by this column (needs `onSort`). */
  sortable?: boolean;
};

export type DataListSort = { key: string; dir: 'asc' | 'desc' };

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
  sort,
  onSort,
  maxHeight,
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
  sort?: DataListSort;
  onSort?: (key: string) => void;
  /** Caps the table height (e.g. `70vh`): rows scroll under a header that stays in view. */
  maxHeight?: string;
}) {
  const colSpan = columns.length;
  /** Clicks on a row's own controls (buttons, inputs, links) don't count as a row click. */
  const handleRowClick = (e: React.MouseEvent, rowIndex: number) => {
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea, label')) return;
    onRowClick?.(rowIndex);
  };

  return (
    <div
      className={
        maxHeight
          ? 'overflow-auto -mx-2 px-2 overscroll-contain'
          : horizontalScroll
            ? 'overflow-x-auto -mx-2 px-2'
            : 'min-w-0 -mx-2 px-2 overflow-x-hidden'
      }
      style={maxHeight ? { maxHeight } : undefined}
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
                'text-xs font-medium text-text-s'
              }
            >
              {columns.map((c) => {
                const sorted = sort?.key === c.key;
                const SortIcon = sort?.dir === 'asc' ? ArrowUp : ArrowDown;
                return (
                  <th
                    key={c.key}
                    aria-sort={sorted ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={`px-3 py-2 whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'}${
                      maxHeight ? ' sticky top-0 z-[2] bg-card' : ''
                    } ${c.headerClassName ?? ''}`}
                  >
                    {c.sortable && onSort ? (
                      <button
                        type="button"
                        onClick={() => onSort(c.key)}
                        className={`inline-flex items-center gap-1 rounded transition-colors hover:text-text-p ${
                          c.align === 'right' ? 'flex-row-reverse' : ''
                        } ${sorted ? 'text-text-p' : ''}`}
                      >
                        {c.label}
                        <SortIcon className={`h-3 w-3 shrink-0 ${sorted ? 'opacity-80' : 'opacity-0'}`} aria-hidden />
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
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
                    onClick={onRowClick ? (e) => handleRowClick(e, i) : undefined}
                  >
                    {cells}
                  </motion.tr>
                );
              }

              return (
                <tr
                  key={rowKey}
                  className={rowClass}
                  onClick={onRowClick ? (e) => handleRowClick(e, i) : undefined}
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
