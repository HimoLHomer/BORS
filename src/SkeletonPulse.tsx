import React from 'react';

/** Matches MarketIndexPanel pulse placeholders (`bg-white/5` + `animate-pulse`). */
export const SKELETON_PULSE = 'bg-white/5 animate-pulse';

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`rounded ${SKELETON_PULSE} ${className}`.trim()} aria-hidden />;
}

/** Inline placeholder for EUR amounts (stats, table cells). */
export function SkeletonCurrency({ className = 'h-7 w-28' }: { className?: string }) {
  return <SkeletonBlock className={className} aria-busy aria-label="Loading" />;
}

/** Two-line gain placeholder (amount + percent). */
export function SkeletonGain({ className = '' }: { className?: string }) {
  return (
    <div className={`inline-block text-right space-y-1 ${className}`.trim()} aria-busy aria-label="Loading">
      <div className={`h-3.5 w-20 rounded ${SKELETON_PULSE} ml-auto`} />
      <div className={`h-3 w-12 rounded ${SKELETON_PULSE} ml-auto`} />
    </div>
  );
}

export function SkeletonLines({
  count = 3,
  className = '',
}: {
  count?: number;
  className?: string;
}) {
  const widths = ['w-full', 'w-5/6', 'w-4/6'];
  return (
    <div className={`space-y-2 ${className}`.trim()} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className={`h-2.5 rounded-full ${SKELETON_PULSE} ${widths[i % widths.length]}`}
        />
      ))}
    </div>
  );
}

export function SkeletonBarChart({ className = '' }: { className?: string }) {
  const barHeights = ['h-[42%]', 'h-[68%]', 'h-[52%]', 'h-[85%]', 'h-[36%]', 'h-[58%]'];
  return (
    <div
      className={`flex items-end justify-around gap-2 sm:gap-3 px-2 sm:px-4 pt-6 pb-10 h-full min-h-[240px] ${className}`.trim()}
      aria-hidden
    >
      {barHeights.map((h, i) => (
        <div key={i} className={`flex-1 max-w-14 ${h} ${SKELETON_PULSE} rounded-t-md`} />
      ))}
    </div>
  );
}

export function SkeletonDividendCalendar() {
  return (
    <div className="flex flex-col flex-1 min-h-0 px-0.5 py-1" aria-hidden>
      <div className="flex items-center justify-between gap-2 shrink-0 pb-1.5 px-0.5">
        <div className="flex items-center gap-0.5 min-w-0">
          <div className={`h-4 w-4 rounded shrink-0 ${SKELETON_PULSE}`} />
          <div className={`h-3 w-16 rounded ${SKELETON_PULSE}`} />
          <div className={`h-4 w-4 rounded shrink-0 ${SKELETON_PULSE}`} />
        </div>
        <div className={`h-3.5 w-14 rounded shrink-0 ${SKELETON_PULSE}`} />
      </div>
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
        <div className="dividend-upcoming-grid h-full w-full">
          <div
            className={`dividend-upcoming-featured rounded-xl border border-border/40 bg-bg/25 p-2.5 flex flex-col items-center justify-center gap-2.5 ${SKELETON_PULSE}`}
          >
            <div className="h-[72px] w-[72px] shrink-0 rounded-full bg-white/5" />
            <div className="flex flex-col items-center gap-0.5">
              <div className="h-3.5 w-14 rounded bg-white/5" />
              <div className="h-2.5 w-10 rounded-full bg-white/5" />
            </div>
          </div>
          <ul className="dividend-upcoming-cluster">
            {[0, 1, 2, 3].map((i) => (
              <li
                key={i}
                className={`rounded-xl border border-border/40 bg-bg/25 p-1.5 flex flex-col items-center justify-center gap-1.5 min-h-0 min-w-0 ${SKELETON_PULSE}`}
              >
                <div className="h-[34px] w-[34px] shrink-0 rounded-full bg-white/5" />
                <div className="flex flex-col items-center gap-px">
                  <div className="h-2.5 w-9 rounded bg-white/5" />
                  <div className="h-2 w-7 rounded-full bg-white/5" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function skeletonCell(align: 'left' | 'right', width: string) {
  return (
    <div
      className={`h-3 ${width} rounded ${SKELETON_PULSE} ${align === 'right' ? 'ml-auto' : ''}`}
    />
  );
}

export function buildTableSkeletonRows(
  count: number,
  columnKeys: string[]
): Record<string, React.ReactNode>[] {
  return Array.from({ length: count }, () => {
    const row: Record<string, React.ReactNode> = {};
    for (const key of columnKeys) {
      if (key === 'asset') {
        row.asset = (
          <div className="space-y-1.5" aria-hidden>
            <div className={`h-3.5 w-32 max-w-full rounded ${SKELETON_PULSE}`} />
            <div className={`h-2 w-14 rounded-full ${SKELETON_PULSE}`} />
          </div>
        );
      } else if (key === 'actions') {
        row.actions = (
          <div
            className={`h-7 w-16 rounded-lg ml-auto ${SKELETON_PULSE}`}
            aria-hidden
          />
        );
      } else {
        const w =
          key === 'shares' ? 'w-10' : key === 'freq' ? 'w-20' : key === 'infoLink' ? 'w-24' : 'w-16';
        row[key] = skeletonCell('right', w);
      }
    }
    return row;
  });
}


