/** Palette + SVG defs for the dashboard allocation pie (size-ranked blue → white). */
import React from 'react';

export type PieSliceChrome = {
  gradientId: string;
  stroke: string;
};

/** Largest slice → smallest, deep blue → pale. Edges are the brighter step, like the portfolio line. */
const SIZE_TIERS: PieSliceChrome[] = [
  { gradientId: 'pieTier0', stroke: '#3b82f6' },
  { gradientId: 'pieTier1', stroke: '#4f8ff8' },
  { gradientId: 'pieTier2', stroke: '#609afa' },
  { gradientId: 'pieTier3', stroke: '#7aabfb' },
  { gradientId: 'pieTier4', stroke: '#93b7fd' },
  { gradientId: 'pieTier5', stroke: '#a9c6fd' },
  { gradientId: 'pieTier6', stroke: '#bfd4fe' },
  { gradientId: 'pieTier7', stroke: '#dbe7fe' },
  { gradientId: 'pieTier8', stroke: '#eff5ff' },
  { gradientId: 'pieTier9', stroke: '#f8fafc' },
];

/** [top, bottom] per tier: lit from above and fading down, like the portfolio area fill. */
const TIER_STOPS: Record<string, [string, string]> = {
  pieTier0: ['#2a64d6', '#0e1c44'],
  pieTier1: ['#2f6fe8', '#13265a'],
  pieTier2: ['#3b82f6', '#1a347a'],
  pieTier3: ['#4f8ff8', '#1e40af'],
  pieTier4: ['#609afa', '#1d4ed8'],
  pieTier5: ['#7aabfb', '#2563eb'],
  pieTier6: ['#93b7fd', '#3b82f6'],
  pieTier7: ['#bfd4fe', '#609afa'],
  pieTier8: ['#dbe7fe', '#93b7fd'],
  pieTier9: ['#eff5ff', '#bfd4fe'],
  pieGradCash: ['#4ade80', '#14532d'],
  pieGradBtc: ['#fbbf24', '#854d0e'],
  pieGradOther: ['#94a3b8', '#334155'],
};

const CASH_CHROME: PieSliceChrome = { gradientId: 'pieGradCash', stroke: '#4ade80' };
const BTC_CHROME: PieSliceChrome = { gradientId: 'pieGradBtc', stroke: '#facc15' };
/** The grouped "Other" slice: neutral, so it doesn't read as one more holding. */
const OTHER_CHROME: PieSliceChrome = { gradientId: 'pieGradOther', stroke: '#94a3b8' };

function isBitcoinAllocationSlice(key: string, label?: string): boolean {
  const fromLabel = (label ?? '').trim().toUpperCase();
  if (fromLabel === 'BTC') return true;
  return key.trim().toUpperCase() === 'BTC';
}

/**
 * @param sizeRank 0 = largest slice (darkest), higher = smaller (lighter).
 * @param sliceCount total slices in the pie (for tier spread).
 */
export function allocationPieSliceChrome(
  key: string,
  sizeRank: number,
  sliceCount: number,
  label?: string
): PieSliceChrome {
  if (key === 'cash') return CASH_CHROME;
  if (key === 'other') return OTHER_CHROME;
  if (isBitcoinAllocationSlice(key, label)) return BTC_CHROME;
  if (sliceCount <= 1) return SIZE_TIERS[0];
  const t = sizeRank / (sliceCount - 1);
  const tierIdx = Math.round(t * (SIZE_TIERS.length - 1));
  /** Keep smallest slices visibly blue — avoid near-white tiers when many holdings. */
  const maxTier = sliceCount >= 8 ? 6 : SIZE_TIERS.length - 1;
  return SIZE_TIERS[Math.min(maxTier, Math.max(0, tierIdx))];
}

export function AllocationPieDefs() {
  return (
    <defs>
      {/* Soft blue halo around the whole pie, matching the portfolio line's glow. */}
      <filter id="allocationPieGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
        <feColorMatrix
          in="blur"
          type="matrix"
          values="0 0 0 0 0.23  0 0 0 0 0.51  0 0 0 0 0.96  0 0 0 0.45 0"
          result="glow"
        />
        <feMerge>
          <feMergeNode in="glow" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="allocationPieGlowHover" x="-55%" y="-55%" width="210%" height="210%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
        <feColorMatrix
          in="blur"
          type="matrix"
          values="0 0 0 0 0.35  0 0 0 0 0.55  0 0 0 0 1  0 0 0 0.72 0"
          result="glow"
        />
        <feMerge>
          <feMergeNode in="glow" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      {Object.entries(TIER_STOPS).map(([id, [top, bottom]]) => (
        <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={top} />
          <stop offset="100%" stopColor={bottom} />
        </linearGradient>
      ))}
    </defs>
  );
}
