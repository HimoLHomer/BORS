import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Group, Ungroup } from 'lucide-react';
import { formatCurrency } from './formatCurrency';
import { formatPercentFi } from './formatNumber';
import { SkeletonBlock } from './SkeletonPulse';
import {
  type AllocationSliceRow,
  allocationDonutArcs,
  donutSegmentPath,
  hitTestAllocationDonut,
  ALLOCATION_DONUT_VIEWBOX,
  ALLOCATION_DONUT_INNER_R,
  ALLOCATION_DONUT_OUTER_R,
  ALLOCATION_DONUT_HOVER_GROW,
} from './allocationPieLabels';
import { AllocationPieDefs, allocationPieChromes, type PieSliceChrome } from './allocationPieChrome';

/** Corner rounding of each ring segment, in viewBox units. */
const ALLOCATION_DONUT_CORNER_R = 3;

function AllocationPieLegendList({
  slices,
  chromes,
  hoveredIndex,
  onHoverIndex,
}: {
  slices: AllocationSliceRow[];
  chromes: PieSliceChrome[];
  hoveredIndex: number | null;
  onHoverIndex: (index: number | null) => void;
}) {
  if (slices.length === 0) return null;

  return (
    <div className="allocation-pie-legend flex max-h-full min-h-0 w-max max-w-[15rem] shrink-0 flex-col self-center border-t border-border/40 pt-2 sm:border-t-0 sm:pt-0 sm:border-l sm:pl-2.5 overflow-y-auto overflow-x-hidden">
      <ul className="m-0 list-none space-y-0.5 p-0">
        {slices.map((slice, index) => {
          const chrome = chromes[index]!;
          const active = hoveredIndex === index;
          return (
            <li key={slice.key}>
              <div
                role="presentation"
                onMouseEnter={() => onHoverIndex(index)}
                className={`allocation-pie-legend-row grid grid-cols-[auto_minmax(2.35rem,4.5rem)_2.5rem_4.85rem] gap-x-2 items-center py-0.5 px-1 rounded-md transition-colors ${
                  active ? 'bg-white/[0.06] ring-1 ring-accent/20' : 'hover:bg-white/[0.04]'
                }`}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full border"
                  style={{ backgroundColor: chrome.stroke, borderColor: chrome.stroke }}
                  aria-hidden
                />
                <span
                  className="min-w-0 truncate text-xs font-semibold text-text-p"
                  title={slice.name}
                >
                  {slice.label}
                </span>
                <span className="text-right text-xs font-sans font-semibold tabular-nums text-text-p">
                  {formatPercentFi(slice.percent, 1)}
                </span>
                <span className="text-right text-xs font-sans font-semibold tabular-nums text-text-s">
                  {formatCurrency(slice.value, 'EUR')}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AllocationPieLegendSkeleton() {
  return (
    <div
      className="flex max-h-full min-h-0 w-max max-w-[15rem] shrink-0 flex-col self-center border-t border-border/40 pt-2 sm:border-t-0 sm:pt-0 sm:border-l sm:pl-2.5 space-y-1.5 overflow-hidden"
      aria-hidden
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="grid grid-cols-[auto_minmax(2.35rem,4.5rem)_2.5rem_4.85rem] gap-x-2 items-center py-0.5 px-1">
          <SkeletonBlock className="h-2 w-2 rounded-full" />
          <SkeletonBlock className="h-3 w-9" />
          <SkeletonBlock className="h-3 w-8" />
          <SkeletonBlock className="h-3 w-14" />
        </div>
      ))}
    </div>
  );
}

export function AllocationPieChart({
  slices,
  holdingsCount,
  loading,
  showAll,
  onToggleShowAll,
}: {
  slices: AllocationSliceRow[];
  /** Number of holdings (the slices fold small ones into "Other"). */
  holdingsCount: number;
  loading: boolean;
  /** Every holding has its own slice (small ones are not folded into "Other"). */
  showAll: boolean;
  onToggleShowAll: () => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const arcs = useMemo(() => allocationDonutArcs(slices), [slices]);
  const chromes = useMemo(() => allocationPieChromes(slices), [slices]);
  const grouped = slices.some((r) => r.key === 'other');
  // The centre button only shows when grouping changes something: there is an "Other" slice,
  // or every holding is listed and some were folded before.
  const canToggleGrouping = grouped || showAll;

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg || loading) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      // Client pixels → viewBox units (the square box is scaled uniformly).
      const scale = ALLOCATION_DONUT_VIEWBOX / Math.min(rect.width, rect.height);
      const x = (e.clientX - rect.left - (rect.width - Math.min(rect.width, rect.height)) / 2) * scale;
      const y = (e.clientY - rect.top - (rect.height - Math.min(rect.width, rect.height)) / 2) * scale;
      const idx = hitTestAllocationDonut(arcs, x, y);
      setHoveredIndex((prev) => (prev === idx ? prev : idx));
    },
    [arcs, loading]
  );

  const hovered = hoveredIndex != null ? slices[hoveredIndex] : undefined;

  return (
    <div
      className="flex flex-col sm:flex-row flex-1 w-full min-h-0 min-w-0 items-center justify-center gap-3 outline-none focus:outline-none focus-visible:outline-none"
      aria-busy={loading}
      onMouseLeave={() => setHoveredIndex(null)}
    >
      <div
        className={`allocation-pie-glow relative aspect-square w-full max-w-[260px] sm:h-full sm:max-h-full sm:w-auto sm:max-w-[min(58%,340px)] sm:min-h-[220px] min-w-[140px] shrink self-center overflow-visible${
          hoveredIndex != null ? ' allocation-pie-glow--hovered' : ''
        }`}
      >
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center z-[1]">
            <SkeletonBlock className="aspect-square h-full max-h-[min(100%,300px)] w-auto max-w-full rounded-full" />
          </div>
        ) : null}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${ALLOCATION_DONUT_VIEWBOX} ${ALLOCATION_DONUT_VIEWBOX}`}
          className={`relative z-[1] h-full w-full overflow-visible${loading ? ' opacity-0' : ''}`}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHoveredIndex(null)}
          aria-hidden
        >
          <AllocationPieDefs />
          {arcs.length === 0 ? (
            <path
              d={donutSegmentPath(0, 360, ALLOCATION_DONUT_INNER_R, ALLOCATION_DONUT_OUTER_R, 0)}
              fill="rgba(34, 39, 52, 0.6)"
              fillRule="evenodd"
              stroke="rgba(59, 130, 246, 0.2)"
            />
          ) : (
            arcs.map((arc) => {
              const row = slices[arc.index]!;
              const chrome = chromes[arc.index]!;
              const active = hoveredIndex === arc.index;
              const dimmed = hoveredIndex != null && !active;
              const outerR = ALLOCATION_DONUT_OUTER_R + (active ? ALLOCATION_DONUT_HOVER_GROW : 0);
              return (
                <path
                  key={row.key}
                  d={donutSegmentPath(arc.startDeg, arc.endDeg, ALLOCATION_DONUT_INNER_R, outerR, ALLOCATION_DONUT_CORNER_R)}
                  fill={`url(#${chrome.gradientId})`}
                  fillRule="evenodd"
                  opacity={dimmed ? 0.45 : 1}
                  style={{ transition: 'opacity 150ms ease-out' }}
                  // Glow only on the hovered slice, like the portfolio line's active point.
                  filter={active ? 'url(#allocationEdgeGlow)' : undefined}
                />
              );
            })
          )}
        </svg>
        {!loading && slices.length > 0 ? (
          // Centre of the ring: the hovered slice's share and value, else a button that lists
          // every holding or folds the small ones back into "Other".
          <div className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center">
            {hovered ? (
              <div className="flex max-w-[52%] flex-col items-center gap-1 text-center">
                <span className="micro-label max-w-full truncate" title={hovered.name}>
                  {hovered.label}
                </span>
                <span className="stat-value !text-[26px]">{formatPercentFi(hovered.percent, 1)}</span>
                <span className="micro-label tabular-nums">{formatCurrency(hovered.value, 'EUR')}</span>
              </div>
            ) : canToggleGrouping ? (
              <button
                type="button"
                onClick={onToggleShowAll}
                aria-pressed={showAll}
                aria-label={showAll ? 'Group small holdings into Other' : `Show all ${holdingsCount} holdings`}
                title={showAll ? 'Group small holdings into Other' : `Show all ${holdingsCount} holdings`}
                // Styled like the app's primary button, sized with the ring.
                className="pointer-events-auto flex aspect-square w-[34%] flex-col items-center justify-center gap-1 rounded-full border border-accent/40 bg-[radial-gradient(circle_at_50%_30%,rgb(96_154_250/0.32),rgb(59_130_246/0.12)_70%)] text-accent-200 shadow-lg shadow-accent/25 transition-all hover:border-accent-300/70 hover:bg-accent hover:text-white active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/60"
              >
                {showAll ? (
                  <Group className="h-[34%] w-[34%]" strokeWidth={2} aria-hidden />
                ) : (
                  <Ungroup className="h-[34%] w-[34%]" strokeWidth={2} aria-hidden />
                )}
                <span className="text-[11px] font-semibold leading-none">{showAll ? 'Group' : 'Show all'}</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {loading ? (
        <AllocationPieLegendSkeleton />
      ) : slices.length > 0 ? (
        <AllocationPieLegendList
          slices={slices}
          chromes={chromes}
          hoveredIndex={hoveredIndex}
          onHoverIndex={setHoveredIndex}
        />
      ) : null}
    </div>
  );
}
