import React from 'react';

export type DataListColumn = {
  key: string;
  label: string;
  align?: 'left' | 'right';
  headerClassName?: string;
  cellClassName?: string;
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
        {showHeader ? (
          <thead>
            <tr className="text-[9px] font-bold text-text-s uppercase tracking-[0.2em] opacity-50">
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
            rows.map((row, i) => (
              <tr
                key={i}
                className={
                  [
                    rowClassName?.(i) ?? dataListRowClassName(i, highlightWhen?.(i)),
                    onRowClick ? 'cursor-pointer hover:outline hover:outline-1 hover:outline-green/30' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')
                }
                onClick={onRowClick ? () => onRowClick(i) : undefined}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={c.cellClassName ?? dataListCellClassName(c.align ?? 'left')}
                  >
                    {row[c.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
