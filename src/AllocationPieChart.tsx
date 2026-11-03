import React, { useCallback, useMemo, useRef, useState } from 'react';
import { formatCurrency } from './formatCurrency';
import { formatPercentFi } from './formatNumber';
import { SkeletonBlock } from './SkeletonPulse';
import {
  type AllocationSliceRow,
  allocationDonutArcs,
  donutSegmentPath,
  hitTestAllocationDonut,
  ALLOCATION_DONUT_VIEWBOX,
  ALLOCATION_DONUT_CENTER,
  ALLOCATION_DONUT_INNER_R,
  ALLOCATION_DONUT_OUTER_R,
  ALLOCATION_DONUT_HOVER_GROW,
} from './allocationPieLabels';
import { AllocationPieDefs, allocationPieChromes, type PieSliceChrome } from './allocationPieChrome';
import { AllocationLavaCore } from './AllocationLavaCore';

/** Corner rounding of each ring segment, in viewBox units. */
const ALLOCATION_DONUT_CORNER_R = 2;
/** A hairline circle just inside the ring. */
const ALLOCATION_DONUT_HAIRLINE_R = ALLOCATION_DONUT_INNER_R - 6;
/** Its twin just outside the ring, clear of the hovered slice's growth. */
const ALLOCATION_DONUT_OUTER_HAIRLINE_R = ALLOCATION_DONUT_OUTER_R + ALLOCATION_DONUT_HOVER_GROW + 3;

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
}: {
  slices: AllocationSliceRow[];
  /** Number of holdings (the slices fold small ones into "Other"). */
  holdingsCount: number;
  loading: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const arcs = useMemo(() => allocationDonutArcs(slices), [slices]);
  const chromes = useMemo(() => allocationPieChromes(slices), [slices]);

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
  const hoveredChrome = hoveredIndex != null ? chromes[hoveredIndex] : undefined;
  // Bumped by each click in the orb, to replay the ring's flash.
  const [pulse, setPulse] = useState(0);

  const slicePaths = arcs.map((arc) => {
    const active = hoveredIndex === arc.index;
    const outerR = ALLOCATION_DONUT_OUTER_R + (active ? ALLOCATION_DONUT_HOVER_GROW : 0);
    return {
      key: slices[arc.index]!.key,
      d: donutSegmentPath(arc.startDeg, arc.endDeg, ALLOCATION_DONUT_INNER_R, outerR, ALLOCATION_DONUT_CORNER_R),
      chrome: chromes[arc.index]!,
      active,
      dimmed: hoveredIndex != null && !active,
    };
  });

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
          {/* The hole, and a hairline just inside the ring. */}
          <circle cx={ALLOCATION_DONUT_CENTER} cy={ALLOCATION_DONUT_CENTER} r={ALLOCATION_DONUT_INNER_R} fill="url(#allocationHoleFill)" />
          <circle
            cx={ALLOCATION_DONUT_CENTER}
            cy={ALLOCATION_DONUT_CENTER}
            r={ALLOCATION_DONUT_HAIRLINE_R}
            fill="none"
            stroke="var(--color-border-strong)"
            strokeWidth={0.75}
          />
          {/* A hairline just outside the ring, clear of the hovered slice's growth. */}
          <circle
            cx={ALLOCATION_DONUT_CENTER}
            cy={ALLOCATION_DONUT_CENTER}
            r={ALLOCATION_DONUT_OUTER_HAIRLINE_R}
            fill="none"
            stroke="var(--color-border-strong)"
            strokeOpacity={0.7}
            strokeWidth={0.6}
          />
          {arcs.length === 0 ? (
            <path
              d={donutSegmentPath(0, 360, ALLOCATION_DONUT_INNER_R, ALLOCATION_DONUT_OUTER_R, 0)}
              fill="var(--color-surface-3)"
              fillRule="evenodd"
            />
          ) : (
            <>
              <clipPath id="allocationRingClip">
                {slicePaths.map(({ key, d }) => (
                  <path key={key} d={d} />
                ))}
              </clipPath>
              {slicePaths.map(({ key, d, chrome, active, dimmed }) => (
                <g key={key} opacity={dimmed ? 0.4 : 1} style={{ transition: 'opacity 150ms ease-out' }}>
                  {/* Soft halo in the slice's colour behind it; stronger on the hovered slice. */}
                  <path d={d} fill={chrome.stroke} fillRule="evenodd" opacity={active ? 0.75 : 0.4} filter="url(#allocationHalo)" />
                  {/* Glassy body: a translucent fill with a bright edge, like the area chart. */}
                  <path
                    d={d}
                    fill={chrome.stroke}
                    fillOpacity={active ? 0.72 : 0.45}
                    fillRule="evenodd"
                    stroke={chrome.stroke}
                    strokeOpacity={0.95}
                    strokeWidth={0.9}
                    strokeLinejoin="round"
                    filter={active ? 'url(#allocationEdgeGlow)' : undefined}
                  />
                </g>
              ))}
              {/* Light on the glass, kept to the slices themselves so the gaps stay clean. */}
              <g clipPath="url(#allocationRingClip)" pointerEvents="none">
                <rect width={ALLOCATION_DONUT_VIEWBOX} height={ALLOCATION_DONUT_VIEWBOX} fill="url(#allocationRingRim)" />
                <rect width={ALLOCATION_DONUT_VIEWBOX} height={ALLOCATION_DONUT_VIEWBOX} fill="url(#allocationRingReflection)" />
                {/* A glint that travels round the ring now and then. */}
                <g className="allocation-ring-glint">
                  <path
                    d={donutSegmentPath(-22, 22, ALLOCATION_DONUT_INNER_R - 4, ALLOCATION_DONUT_OUTER_R + ALLOCATION_DONUT_HOVER_GROW + 4, 0)}
                    fill="url(#allocationRingGlint)"
                    filter="url(#allocationGlintBlur)"
                  />
                </g>
                {/* Each click in the orb flashes the ring once its ripple reaches it. */}
                {pulse > 0 ? (
                  <rect
                    key={pulse}
                    className="allocation-ring-pulse"
                    width={ALLOCATION_DONUT_VIEWBOX}
                    height={ALLOCATION_DONUT_VIEWBOX}
                    fill="#fff"
                  />
                ) : null}
              </g>
            </>
          )}
        </svg>
        {!loading && slices.length > 0 ? (
          // A toy in the hole, just inside the hairline: drifting light the pointer can stir.
          <AllocationLavaCore
            diameterPercent={(ALLOCATION_DONUT_HAIRLINE_R * 2 * 100) / ALLOCATION_DONUT_VIEWBOX}
            colours={chromes.map((c) => c.stroke)}
            shares={slices.map((s) => s.percent)}
            highlight={hoveredIndex}
            onPoke={() => setPulse((p) => p + 1)}
          />
        ) : null}
        {!loading && slices.length > 0 ? (
          // Centre of the ring: the hovered slice's share and value, else the holdings count.
          <div className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center [text-shadow:0_1px_10px_rgb(0_0_0/0.75)]">
            {hovered ? (
              // Laid out like the app's other stats: micro-label, stat-value, stat-subline.
              <div className="flex max-w-[60%] flex-col items-center text-center">
                <span className="mb-1.5 flex max-w-full items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: hoveredChrome?.stroke }} aria-hidden />
                  <span className="micro-label truncate" title={hovered.name}>
                    {hovered.label}
                  </span>
                </span>
                <span className="stat-value !text-[28px] tabular-nums">{formatPercentFi(hovered.percent, 1)}</span>
                <span className="stat-subline !mt-1.5">{formatCurrency(hovered.value, 'EUR')}</span>
              </div>
            ) : (
              <div className="flex max-w-[60%] flex-col items-center text-center">
                <span className="micro-label mb-1.5">Holdings</span>
                <span className="stat-value !text-[28px] tabular-nums">{holdingsCount}</span>
              </div>
            )}
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
