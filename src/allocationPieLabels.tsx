const PIE_SIZE_SCALE = 1.064;

/** Room for enlarged pie inside the SVG. */
export const ALLOCATION_PIE_CHART_MARGIN = {
  top: 12,
  right: 12,
  bottom: 12,
  left: 12,
} as const;
export const ALLOCATION_PIE_PADDING_ANGLE = 1.2;
export const ALLOCATION_PIE_OUTER_RADIUS_FRAC = 0.84 * PIE_SIZE_SCALE;
export const ALLOCATION_PIE_BASE_START_ANGLE = 90;
export const ALLOCATION_PIE_BASE_END_ANGLE = -270;

export type AllocationPieMargin = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

const PIE_START_ANGLE = ALLOCATION_PIE_BASE_START_ANGLE;
const PIE_END_ANGLE = ALLOCATION_PIE_BASE_END_ANGLE;

export type AllocationSliceRow = {
  key: string;
  name: string;
  /** Short ticker shown in the legend list. */
  label: string;
  value: number;
  percent: number;
};

function mathSign(n: number): number {
  if (n === 0) return 0;
  return n > 0 ? 1 : -1;
}

function angleInPieSweep(pointer: number, start: number, end: number, deltaAngle: number): boolean {
  if (deltaAngle < 0) {
    if (start >= end) return pointer <= start && pointer >= end;
    return pointer <= start || pointer >= end;
  }
  if (start <= end) return pointer >= start && pointer <= end;
  return pointer >= start || pointer <= end;
}

function angularDistanceDeg(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/** Geometry hit-test — contiguous sectors (no padding gaps), nearest-slice fallback. */
export function hitTestAllocationPieSliceIndex(
  width: number,
  height: number,
  slices: AllocationSliceRow[],
  localX: number,
  localY: number,
  margins: AllocationPieMargin = {
    top: ALLOCATION_PIE_CHART_MARGIN.top,
    right: ALLOCATION_PIE_CHART_MARGIN.right,
    bottom: ALLOCATION_PIE_CHART_MARGIN.bottom,
    left: ALLOCATION_PIE_CHART_MARGIN.left,
  }
): number | null {
  if (width < 64 || height < 64 || slices.length === 0) return null;

  const { top: mt, right: mr, bottom: mb, left: ml } = margins;
  const cw = width - ml - mr;
  const ch = height - mt - mb;
  if (cw < 32 || ch < 32) return null;

  const maxR = Math.min(cw, ch) / 2;
  const cx = ml + cw / 2;
  const cy = mt + ch / 2;
  const or = ALLOCATION_PIE_OUTER_RADIUS_FRAC * maxR;

  const dx = localX - cx;
  const dy = localY - cy;
  const dist = Math.hypot(dx, dy);
  if (dist > or + 4) return null;

  const pointerAngle = (-Math.atan2(dy, dx) * 180) / Math.PI;

  const startAngle = PIE_START_ANGLE;
  const endAngle = PIE_END_ANGLE;
  const deltaAngle = endAngle - startAngle;
  const absDelta = Math.abs(deltaAngle);
  const sum = slices.reduce((a, s) => a + (Number.isFinite(s.value) && s.value > 0 ? s.value : 0), 0);
  if (sum <= 0) return null;

  let cursor = startAngle;
  let hit: number | null = null;
  let nearestIdx: number | null = null;
  let nearestDist = Infinity;

  slices.forEach((entry, i) => {
    const val = Number.isFinite(entry.value) && entry.value > 0 ? entry.value : 0;
    if (val === 0) return;
    const pct = val / sum;
    const tempStart = cursor;
    const tempEnd = cursor + mathSign(deltaAngle) * pct * absDelta;
    const mid = (tempStart + tempEnd) / 2;
    const distToMid = angularDistanceDeg(pointerAngle, mid);
    if (distToMid < nearestDist) {
      nearestDist = distToMid;
      nearestIdx = i;
    }
    if (angleInPieSweep(pointerAngle, tempStart, tempEnd, deltaAngle)) hit = i;
    cursor = tempEnd;
  });

  return hit ?? nearestIdx;
}
