import React, { useCallback, useRef, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { formatCurrency } from './formatCurrency';
import { formatPercentFi } from './formatNumber';
import { SkeletonBlock } from './SkeletonPulse';
import {
  type AllocationSliceRow,
  hitTestAllocationPieSliceIndex,
  ALLOCATION_PIE_CHART_MARGIN,
  ALLOCATION_PIE_PADDING_ANGLE,
  ALLOCATION_PIE_BASE_START_ANGLE,
  ALLOCATION_PIE_BASE_END_ANGLE,
  ALLOCATION_PIE_OUTER_RADIUS_FRAC,
} from './allocationPieLabels';
import { AllocationPieDefs, allocationPieSliceChrome } from './allocationPieChrome';

const outerRadiusPct = `${Math.round(ALLOCATION_PIE_OUTER_RADIUS_FRAC * 1000) / 10}%`;

function AllocationPieLegendList({
  slices,
  hoveredIndex,
  onHoverIndex,
}: {
  slices: AllocationSliceRow[];
  hoveredIndex: number | null;
  onHoverIndex: (index: number | null) => void;
}) {
  if (slices.length === 0) return null;

  return (
    <div className="allocation-pie-legend flex max-h-full min-h-0 w-max max-w-[13rem] shrink-0 flex-col self-center border-l border-border/40 pl-2.5 overflow-y-auto overflow-x-hidden">
      <ul className="m-0 list-none space-y-0.5 p-0">
        {slices.map((slice, index) => {
          const chrome = allocationPieSliceChrome(slice.key, index, slices.length);
          const active = hoveredIndex === index;
          return (
            <li key={slice.key}>
              <div
                role="presentation"
                onMouseEnter={() => onHoverIndex(index)}
                className={`allocation-pie-legend-row grid grid-cols-[auto_2.35rem_2.5rem_4.85rem] gap-x-2 items-center py-0.5 px-1 rounded-md transition-colors ${
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
                <span className="text-right text-[10px] font-sans font-semibold tabular-nums text-accent">
                  {formatPercentFi(slice.percent, 1)}
                </span>
                <span className="text-right text-[10px] font-sans font-semibold tabular-nums text-text-s/80">
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
      className="flex max-h-full min-h-0 w-max max-w-[13rem] shrink-0 flex-col self-center border-l border-border/40 pl-2.5 space-y-1.5 overflow-hidden"
      aria-hidden
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="grid grid-cols-[auto_2.35rem_2.5rem_4.85rem] gap-x-2 items-center py-0.5 px-1">
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
  loading,
}: {
  slices: AllocationSliceRow[];
  loading: boolean;
}) {
  const pieHitRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const pendingPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const clearHover = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    pendingPointerRef.current = null;
    setHoveredIndex(null);
  }, []);

  const scheduleHoverUpdate = useCallback(
    (clientX: number, clientY: number) => {
      pendingPointerRef.current = { clientX, clientY };
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const pending = pendingPointerRef.current;
        pendingPointerRef.current = null;
        const el = pieHitRef.current;
        if (!pending || !el || loading || slices.length === 0) return;
        const rect = el.getBoundingClientRect();
        if (rect.width < 64 || rect.height < 64) return;
        const idx = hitTestAllocationPieSliceIndex(
          rect.width,
          rect.height,
          slices,
          pending.clientX - rect.left,
          pending.clientY - rect.top,
          { ...ALLOCATION_PIE_CHART_MARGIN }
        );
        setHoveredIndex((prev) => (prev === idx ? prev : idx));
      });
    },
    [slices, loading]
  );

  return (
    <div
      className="flex flex-row flex-1 w-full min-h-0 min-w-0 items-center justify-center gap-3 outline-none focus:outline-none focus-visible:outline-none"
      aria-busy={loading}
      onMouseLeave={clearHover}
    >
      <div
        ref={pieHitRef}
        className={`allocation-pie-glow relative aspect-square h-full max-h-full w-auto max-w-[min(58%,340px)] min-h-[220px] min-w-[160px] flex-none self-center overflow-visible${
          hoveredIndex != null ? ' allocation-pie-glow--hovered' : ''
        }`}
        onMouseMove={(e) => scheduleHoverUpdate(e.clientX, e.clientY)}
      >
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center z-[1]">
            <SkeletonBlock className="aspect-square h-full max-h-[min(100%,300px)] w-auto max-w-full rounded-full" />
          </div>
        ) : null}
        <ResponsiveContainer
          width="100%"
          height="100%"
          className={loading ? 'opacity-0 pointer-events-none' : 'pointer-events-none'}
        >
          <PieChart
            accessibilityLayer={false}
            margin={{ ...ALLOCATION_PIE_CHART_MARGIN }}
            style={{ outline: 'none', pointerEvents: 'none' }}
            tabIndex={-1}
          >
            <AllocationPieDefs />
            <Pie
              key={
                slices.length > 0
                  ? [...new Set(slices.map((r) => r.key))].sort().join('|')
                  : 'empty-allocation'
              }
              data={
                slices.length > 0
                  ? slices
                  : [{ key: 'empty', name: 'No holdings', label: '—', value: 1, percent: 0 }]
              }
              cx="50%"
              cy="50%"
              innerRadius="0%"
              outerRadius={outerRadiusPct}
              dataKey="value"
              nameKey="name"
              startAngle={ALLOCATION_PIE_BASE_START_ANGLE}
              endAngle={ALLOCATION_PIE_BASE_END_ANGLE}
              paddingAngle={ALLOCATION_PIE_PADDING_ANGLE}
              stroke="rgba(15, 23, 42, 0.85)"
              strokeWidth={1.5}
              isAnimationActive={false}
              activeShape={false}
              label={false}
              labelLine={false}
            >
              {slices.length > 0 ? (
                slices.map((row, index) => {
                  const chrome = allocationPieSliceChrome(row.key, index, slices.length);
                  const active = hoveredIndex === index;
                  return (
                    <Cell
                      key={row.key}
                      fill={`url(#${chrome.gradientId})`}
                      stroke={chrome.stroke}
                      strokeWidth={active ? 3 : 2}
                      style={{
                        pointerEvents: 'none',
                        filter: active ? 'url(#allocationPieGlowHover)' : undefined,
                      }}
                    />
                  );
                })
              ) : (
                <Cell fill="rgba(39, 39, 42, 0.6)" stroke="rgba(59, 130, 246, 0.2)" />
              )}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      {loading ? (
        <AllocationPieLegendSkeleton />
      ) : slices.length > 0 ? (
        <AllocationPieLegendList
          slices={slices}
          hoveredIndex={hoveredIndex}
          onHoverIndex={setHoveredIndex}
        />
      ) : null}
    </div>
  );
}
