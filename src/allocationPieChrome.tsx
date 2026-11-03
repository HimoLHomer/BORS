/**
 * Palette + SVG defs for the dashboard allocation donut: solid segments in the app's colour
 * tokens, slightly deeper toward the hole. The hovered slice gets the portfolio line's glow.
 */
import React from 'react';
import {
  ALLOCATION_DONUT_CENTER,
  ALLOCATION_DONUT_HOVER_GROW,
  ALLOCATION_DONUT_INNER_R,
  ALLOCATION_DONUT_OUTER_R,
} from './allocationPieLabels';

export type PieSliceChrome = {
  gradientId: string;
  /** Slice and legend dot colour. */
  stroke: string;
};

/**
 * Holdings by size, largest first. Accent shades alternate light/dark so neighbouring slices
 * stay apart; the largest slice gets the app's main accent.
 */
const ACCENT_TIERS: PieSliceChrome[] = [
  { gradientId: 'pieTier0', stroke: 'var(--color-accent-500)' },
  { gradientId: 'pieTier1', stroke: 'var(--color-accent-300)' },
  { gradientId: 'pieTier2', stroke: 'var(--color-accent-700)' },
  { gradientId: 'pieTier3', stroke: 'var(--color-accent-200)' },
  { gradientId: 'pieTier4', stroke: 'var(--color-accent-400)' },
  { gradientId: 'pieTier5', stroke: 'var(--color-accent-600)' },
  { gradientId: 'pieTier6', stroke: 'var(--color-accent-100)' },
  { gradientId: 'pieTier7', stroke: 'var(--color-accent-800)' },
];

const CASH_CHROME: PieSliceChrome = { gradientId: 'pieGradCash', stroke: 'var(--color-green)' };
const BTC_CHROME: PieSliceChrome = { gradientId: 'pieGradBtc', stroke: '#facc15' };
/** The grouped "Other" slice: neutral, so it doesn't read as one more holding. */
const OTHER_CHROME: PieSliceChrome = { gradientId: 'pieGradOther', stroke: 'var(--color-text-s)' };

const ALL_CHROMES = [...ACCENT_TIERS, CASH_CHROME, BTC_CHROME, OTHER_CHROME];

function isBitcoinAllocationSlice(key: string, label?: string): boolean {
  const fromLabel = (label ?? '').trim().toUpperCase();
  if (fromLabel === 'BTC') return true;
  return key.trim().toUpperCase() === 'BTC';
}

/**
 * Colours for slices sorted largest first. Cash, Bitcoin and "Other" keep their own colours
 * and are skipped in the accent sequence, so the holdings around them keep theirs.
 */
export function allocationPieChromes(slices: { key: string; label?: string }[]): PieSliceChrome[] {
  let accentRank = 0;
  return slices.map(({ key, label }) => {
    if (key === 'cash') return CASH_CHROME;
    if (key === 'other') return OTHER_CHROME;
    if (isBitcoinAllocationSlice(key, label)) return BTC_CHROME;
    return ACCENT_TIERS[accentRank++ % ACCENT_TIERS.length]!;
  });
}

/** Fill stops along the radius: a touch deeper at the hole, full colour at the outer edge. */
const FILL_REACH = ALLOCATION_DONUT_OUTER_R + ALLOCATION_DONUT_HOVER_GROW;
const FILL_STOPS: [offset: number, opacity: number][] = [
  [ALLOCATION_DONUT_INNER_R / FILL_REACH, 0.78],
  [ALLOCATION_DONUT_OUTER_R / FILL_REACH, 1],
  [1, 1],
];

export function AllocationPieDefs() {
  return (
    <defs>
      {/* The portfolio line's glow, for the hovered slice. */}
      <filter id="allocationEdgeGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="2" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      {ALL_CHROMES.map(({ gradientId, stroke }) => (
        <radialGradient
          key={gradientId}
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          cx={ALLOCATION_DONUT_CENTER}
          cy={ALLOCATION_DONUT_CENTER}
          r={FILL_REACH}
        >
          {FILL_STOPS.map(([offset, opacity]) => (
            <stop key={offset} offset={`${(offset * 100).toFixed(1)}%`} stopColor={stroke} stopOpacity={opacity} />
          ))}
        </radialGradient>
      ))}
    </defs>
  );
}
