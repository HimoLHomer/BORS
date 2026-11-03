/**
 * Palette + SVG defs for the dashboard allocation donut: translucent segments with bright
 * edges and a soft halo, in the app's colour tokens, under a glass sheen and a travelling glint.
 * The hovered slice glows brighter.
 */
import React from 'react';
import {
  ALLOCATION_DONUT_CENTER,
  ALLOCATION_DONUT_HOVER_GROW,
  ALLOCATION_DONUT_INNER_R,
  ALLOCATION_DONUT_OUTER_R,
} from './allocationPieLabels';

export type PieSliceChrome = {
  /** Slice and legend dot colour. */
  stroke: string;
};

/**
 * Holdings shade from deep blue (largest) to light blue (smallest), in even steps by rank, so
 * the ring reads as one ramp of weight. The ends are the blue scale's 600 and 300: deeper sinks
 * to navy on the dark panel, lighter glares near-white.
 */
const HOLDING_DEEPEST: Rgb = [37, 99, 235]; // accent-600
const HOLDING_LIGHTEST: Rgb = [147, 183, 253]; // accent-300

type Rgb = [number, number, number];

/** The blue for the holding at `rank` (0 = largest) of `count` holdings. */
function holdingShade(rank: number, count: number): PieSliceChrome {
  const t = count > 1 ? rank / (count - 1) : 0;
  const [r, g, b] = HOLDING_DEEPEST.map((c, i) => Math.round(c + (HOLDING_LIGHTEST[i]! - c) * t));
  return { stroke: `#${[r, g, b].map((c) => c!.toString(16).padStart(2, '0')).join('')}` };
}

const CASH_CHROME: PieSliceChrome = { stroke: 'var(--color-green)' };
/** Bitcoin's own orange. */
const BTC_CHROME: PieSliceChrome = { stroke: '#f7931a' };
/** The grouped "Other" slice: a dim slate, so it recedes instead of reading as one more holding. */
const OTHER_CHROME: PieSliceChrome = { stroke: '#64748b' };

function isBitcoinAllocationSlice(key: string, label?: string): boolean {
  const fromLabel = (label ?? '').trim().toUpperCase();
  if (fromLabel === 'BTC') return true;
  return key.trim().toUpperCase() === 'BTC';
}

function ownChrome(key: string, label?: string): PieSliceChrome | null {
  if (key === 'cash') return CASH_CHROME;
  if (key === 'other') return OTHER_CHROME;
  if (isBitcoinAllocationSlice(key, label)) return BTC_CHROME;
  return null;
}

/**
 * Colours for slices sorted largest first. Cash, Bitcoin and "Other" keep their own colours
 * and are skipped in the blue ramp, so the holdings around them keep theirs.
 */
export function allocationPieChromes(slices: { key: string; label?: string }[]): PieSliceChrome[] {
  const holdingCount = slices.filter(({ key, label }) => !ownChrome(key, label)).length;
  let rank = 0;
  return slices.map(({ key, label }) => ownChrome(key, label) ?? holdingShade(rank++, holdingCount));
}

export function AllocationPieDefs() {
  return (
    <defs>
      {/* The portfolio line's glow, for the hovered slice. */}
      <filter id="allocationEdgeGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="2.5" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      {/* Wide soft blur drawn behind every slice, so the ring glows on the dark panel. */}
      <filter id="allocationHalo" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="5" />
      </filter>
      {/* Glass sheen over the ring: brighter toward the outer rim, like light caught in a tube. */}
      <radialGradient
        id="allocationRingRim"
        gradientUnits="userSpaceOnUse"
        cx={ALLOCATION_DONUT_CENTER}
        cy={ALLOCATION_DONUT_CENTER}
        r={ALLOCATION_DONUT_OUTER_R + ALLOCATION_DONUT_HOVER_GROW}
      >
        <stop offset={`${((ALLOCATION_DONUT_INNER_R / (ALLOCATION_DONUT_OUTER_R + ALLOCATION_DONUT_HOVER_GROW)) * 100).toFixed(1)}%`} stopColor="#000" stopOpacity={0.28} />
        <stop offset={`${(((ALLOCATION_DONUT_INNER_R + ALLOCATION_DONUT_OUTER_R) / 2 / (ALLOCATION_DONUT_OUTER_R + ALLOCATION_DONUT_HOVER_GROW)) * 100).toFixed(1)}%`} stopColor="#fff" stopOpacity={0} />
        <stop offset={`${((ALLOCATION_DONUT_OUTER_R / (ALLOCATION_DONUT_OUTER_R + ALLOCATION_DONUT_HOVER_GROW)) * 100).toFixed(1)}%`} stopColor="#fff" stopOpacity={0.06} />
        <stop offset="100%" stopColor="#fff" stopOpacity={0.06} />
      </radialGradient>
      {/* A soft reflection from the top left, where the panels' ambient light comes from. */}
      <linearGradient id="allocationRingReflection" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#fff" stopOpacity={0.06} />
        <stop offset="45%" stopColor="#fff" stopOpacity={0} />
      </linearGradient>
      {/* The glint that travels round the ring: bright in the middle, fading at both ends. */}
      <linearGradient id="allocationRingGlint" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#fff" stopOpacity={0} />
        <stop offset="50%" stopColor="#fff" stopOpacity={0.55} />
        <stop offset="100%" stopColor="#fff" stopOpacity={0} />
      </linearGradient>
      <filter id="allocationGlintBlur" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3" />
      </filter>
      {/* The hole: a faint accent wash at the top, like the panels' ambient light. */}
      <radialGradient
        id="allocationHoleFill"
        gradientUnits="userSpaceOnUse"
        cx={ALLOCATION_DONUT_CENTER}
        cy={ALLOCATION_DONUT_CENTER - ALLOCATION_DONUT_INNER_R * 0.55}
        r={ALLOCATION_DONUT_INNER_R * 1.4}
      >
        <stop offset="0%" stopColor="var(--color-accent-500)" stopOpacity={0.1} />
        <stop offset="100%" stopColor="var(--color-accent-500)" stopOpacity={0} />
      </radialGradient>
    </defs>
  );
}
