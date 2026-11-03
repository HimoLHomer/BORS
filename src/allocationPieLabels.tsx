export type AllocationSliceRow = {
  key: string;
  name: string;
  /** Short ticker shown in the legend list. */
  label: string;
  value: number;
  percent: number;
};

/** Donut geometry in SVG viewBox units (the chart is drawn in a 200 × 200 box). */
export const ALLOCATION_DONUT_VIEWBOX = 200;
export const ALLOCATION_DONUT_CENTER = 100;
export const ALLOCATION_DONUT_OUTER_R = 92;
export const ALLOCATION_DONUT_INNER_R = 76;
/** The hovered slice grows outward by this much. */
export const ALLOCATION_DONUT_HOVER_GROW = 3;
/** Gap between neighbouring slices, in degrees. */
export const ALLOCATION_DONUT_GAP_DEG = 1.5;
/** A slice never gives up more than this share of its own angle to gaps. */
const MAX_GAP_SHARE = 0.4;

export type AllocationDonutArc = {
  index: number;
  /**
   * The slice's true extent, clockwise from 12 o'clock: exactly its share of 360°. Neighbouring
   * slices share these boundaries, so the arcs add up to the whole circle.
   */
  trueStartDeg: number;
  trueEndDeg: number;
  /** What is drawn: the true extent less half a gap at each end, so gaps sit on the boundaries. */
  startDeg: number;
  endDeg: number;
};

/**
 * Arcs for the donut. Gaps are centred on the true boundaries and taken equally from both
 * neighbours, so every boundary stays where the percentages put it: a 75% slice runs from one
 * gap's centre line to the next across exactly 270°. (Padding added between slices instead would
 * shrink every slice by the total gap angle.)
 */
export function allocationDonutArcs(
  slices: Pick<AllocationSliceRow, 'value'>[],
  gapDeg: number = ALLOCATION_DONUT_GAP_DEG
): AllocationDonutArc[] {
  const values = slices.map((s) => (Number.isFinite(s.value) && s.value > 0 ? s.value : 0));
  const sum = values.reduce((a, v) => a + v, 0);
  if (sum <= 0) return [];
  const drawn = values.filter((v) => v > 0).length;
  const arcs: AllocationDonutArc[] = [];
  let cursor = 0;
  values.forEach((v, index) => {
    if (v <= 0) return;
    const span = (v / sum) * 360;
    const trueStartDeg = cursor;
    const trueEndDeg = cursor + span;
    cursor = trueEndDeg;
    const half = drawn > 1 ? Math.min(gapDeg, span * MAX_GAP_SHARE) / 2 : 0;
    arcs.push({ index, trueStartDeg, trueEndDeg, startDeg: trueStartDeg + half, endDeg: trueEndDeg - half });
  });
  // Close the circle exactly despite floating-point drift.
  const last = arcs[arcs.length - 1];
  if (last) {
    const half = last.trueEndDeg - last.endDeg;
    last.trueEndDeg = 360;
    last.endDeg = 360 - half;
  }
  return arcs;
}

/**
 * Slice under a point given in viewBox units, or null outside the ring (the centre shows the
 * total). A point in a gap belongs to the slice whose true extent contains it.
 */
export function hitTestAllocationDonut(arcs: AllocationDonutArc[], x: number, y: number): number | null {
  const dx = x - ALLOCATION_DONUT_CENTER;
  const dy = y - ALLOCATION_DONUT_CENTER;
  const dist = Math.hypot(dx, dy);
  if (dist < ALLOCATION_DONUT_INNER_R - 2 || dist > ALLOCATION_DONUT_OUTER_R + ALLOCATION_DONUT_HOVER_GROW + 2) {
    return null;
  }
  // Clockwise from 12 o'clock (SVG y grows downward).
  const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  const arc = arcs.find((a) => deg >= a.trueStartDeg && deg < a.trueEndDeg) ?? arcs[arcs.length - 1];
  return arc ? arc.index : null;
}

function point(r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [ALLOCATION_DONUT_CENTER + r * Math.sin(rad), ALLOCATION_DONUT_CENTER - r * Math.cos(rad)];
}

const f = (n: number) => n.toFixed(3);

/**
 * SVG path for a ring segment from `startDeg` to `endDeg` (clockwise from 12 o'clock) with
 * rounded corners. The rounding stays inside the segment, so it never changes its extent.
 */
export function donutSegmentPath(
  startDeg: number,
  endDeg: number,
  innerR: number,
  outerR: number,
  cornerR: number
): string {
  const sweep = endDeg - startDeg;
  if (sweep >= 359.999) {
    // Full ring: two half-circle arcs per edge, inner one drawn the other way to leave a hole.
    const [ox, oy] = point(outerR, 0);
    const [ox2, oy2] = point(outerR, 180);
    const [ix, iy] = point(innerR, 0);
    const [ix2, iy2] = point(innerR, 180);
    return [
      `M${f(ox)},${f(oy)}`,
      `A${outerR},${outerR} 0 1 1 ${f(ox2)},${f(oy2)}`,
      `A${outerR},${outerR} 0 1 1 ${f(ox)},${f(oy)}`,
      `M${f(ix)},${f(iy)}`,
      `A${innerR},${innerR} 0 1 0 ${f(ix2)},${f(iy2)}`,
      `A${innerR},${innerR} 0 1 0 ${f(ix)},${f(iy)}`,
      'Z',
    ].join(' ');
  }
  // Corners can't be rounder than half the ring's thickness or than the segment allows.
  const maxByArc = ((sweep * Math.PI) / 180) * innerR * 0.5;
  const c = Math.max(0, Math.min(cornerR, (outerR - innerR) / 2, maxByArc));
  // Angle the corner takes along each edge.
  const aOut = c > 0 ? (c / outerR) * (180 / Math.PI) : 0;
  const aIn = c > 0 ? (c / innerR) * (180 / Math.PI) : 0;
  const large = (deg: number) => (deg > 180 ? 1 : 0);

  const p1 = point(outerR - c, startDeg); // start edge, near outer corner
  const p2 = point(outerR, startDeg + aOut);
  const p3 = point(outerR, endDeg - aOut);
  const p4 = point(outerR - c, endDeg);
  const p5 = point(innerR + c, endDeg);
  const p6 = point(innerR, endDeg - aIn);
  const p7 = point(innerR, startDeg + aIn);
  const p8 = point(innerR + c, startDeg);
  const cornerO1 = point(outerR, startDeg);
  const cornerO2 = point(outerR, endDeg);
  const cornerI2 = point(innerR, endDeg);
  const cornerI1 = point(innerR, startDeg);

  return [
    `M${f(p1[0])},${f(p1[1])}`,
    `Q${f(cornerO1[0])},${f(cornerO1[1])} ${f(p2[0])},${f(p2[1])}`,
    `A${outerR},${outerR} 0 ${large(sweep - 2 * aOut)} 1 ${f(p3[0])},${f(p3[1])}`,
    `Q${f(cornerO2[0])},${f(cornerO2[1])} ${f(p4[0])},${f(p4[1])}`,
    `L${f(p5[0])},${f(p5[1])}`,
    `Q${f(cornerI2[0])},${f(cornerI2[1])} ${f(p6[0])},${f(p6[1])}`,
    `A${innerR},${innerR} 0 ${large(sweep - 2 * aIn)} 0 ${f(p7[0])},${f(p7[1])}`,
    `Q${f(cornerI1[0])},${f(cornerI1[1])} ${f(p8[0])},${f(p8[1])}`,
    'Z',
  ].join(' ');
}
