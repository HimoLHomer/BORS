/** Palette + SVG defs for the dashboard allocation pie (size-ranked blue → white). */
import React from 'react';

export type PieSliceChrome = {
  gradientId: string;
  stroke: string;
};

/** Darkest (largest slice) → near-white (smallest). */
const SIZE_TIERS: PieSliceChrome[] = [
  { gradientId: 'pieTier0', stroke: '#1e40af' },
  { gradientId: 'pieTier1', stroke: '#1d4ed8' },
  { gradientId: 'pieTier2', stroke: '#2563eb' },
  { gradientId: 'pieTier3', stroke: '#3b82f6' },
  { gradientId: 'pieTier4', stroke: '#60a5fa' },
  { gradientId: 'pieTier5', stroke: '#93c5fd' },
  { gradientId: 'pieTier6', stroke: '#bfdbfe' },
  { gradientId: 'pieTier7', stroke: '#e2e8f0' },
  { gradientId: 'pieTier8', stroke: '#f1f5f9' },
  { gradientId: 'pieTier9', stroke: '#f8fafc' },
];

/** [inner, outer] per tier — overall a bit darker than before. */
const TIER_STOPS: Record<string, [string, string]> = {
  pieTier0: ['#1e3a8a', '#0c1929'],
  pieTier1: ['#1e40af', '#0f172a'],
  pieTier2: ['#1d4ed8', '#172554'],
  pieTier3: ['#2563eb', '#1e3a8a'],
  pieTier4: ['#3b82f6', '#1e40af'],
  pieTier5: ['#60a5fa', '#2563eb'],
  pieTier6: ['#93c5fd', '#3b82f6'],
  pieTier7: ['#bfdbfe', '#60a5fa'],
  pieTier8: ['#dbeafe', '#93c5fd'],
  pieTier9: ['#f1f5f9', '#e2e8f0'],
  pieGradCash: ['#22c55e', '#14532d'],
};

const CASH_CHROME: PieSliceChrome = { gradientId: 'pieGradCash', stroke: '#4ade80' };

/**
 * @param sizeRank 0 = largest slice (darkest), higher = smaller (lighter).
 * @param sliceCount total slices in the pie (for tier spread).
 */
export function allocationPieSliceChrome(
  key: string,
  sizeRank: number,
  sliceCount: number
): PieSliceChrome {
  if (key === 'cash') return CASH_CHROME;
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
      <filter id="allocationPieGlow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
        <feColorMatrix
          in="blur"
          type="matrix"
          values="0 0 0 0 0.18  0 0 0 0 0.38  0 0 0 0 0.82  0 0 0 0.28 0"
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
      {Object.entries(TIER_STOPS).map(([id, [inner, outer]]) => (
        <radialGradient key={id} id={id} cx="42%" cy="38%" r="72%">
          <stop offset="0%" stopColor={inner} stopOpacity={0.96} />
          <stop offset="58%" stopColor={inner} stopOpacity={0.88} />
          <stop offset="100%" stopColor={outer} stopOpacity={0.92} />
        </radialGradient>
      ))}
    </defs>
  );
}
