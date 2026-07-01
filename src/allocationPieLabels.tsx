import type { ReactNode } from 'react';
import type { PieLabelRenderProps } from 'recharts';
import { formatPercentFi } from './formatNumber';

/** Must match default <PieChart margin> for the allocation card. */
export const ALLOCATION_PIE_CHART_MARGIN = { top: 46, right: 72, bottom: 14, left: 72 } as const;
export const ALLOCATION_PIE_PADDING_ANGLE = 1.2;
export const ALLOCATION_PIE_OUTER_RADIUS_FRAC = 0.75;
/** Shift left legend rows up from the chart top margin (negative = higher). */
export const LEFT_LEGEND_Y_OFFSET_PX = -28;

export type AllocationPieMargin = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

const RADIAL_STUB = 18;
const TEXT_PAD = 6;
const LABEL_FONT_PX = 11;
const LABEL_EDGE_PAD = 6;
/** Fixed vertical gap between legend rows (px). */
const LEGEND_SLOT_GAP = 32;
const LEGEND_SLOT_GAP_MIN = 22;
/** Left-column legend slots — dynamic up to available chart height. */
const LEFT_LEGEND_SLOTS_MAX = 16;
const PIE_START_ANGLE = 90;
const PIE_END_ANGLE = -270;

export type AllocationSliceRow = {
  key: string;
  name: string;
  /** Short ticker shown in pie callouts. */
  label: string;
  value: number;
  percent: number;
};

export type AllocationCalloutLayout = {
  pEdge: { x: number; y: number };
  pKink: { x: number; y: number };
  pJoint: { x: number; y: number };
  yCenter: number;
  side: 'L' | 'R';
  sign: 1 | -1;
  displayName: string;
  pctLine: string;
  anchor: 'start' | 'end';
};

const STRAIGHT_Y_EPS = 8;

/** At most one bend: straight when aligned, else elbow at horizontal midpoint. */
function calloutPathD(
  side: 'L' | 'R',
  pEdge: { x: number; y: number },
  jx: number,
  yc: number
): string {
  if (side === 'R') {
    return `M ${pEdge.x} ${pEdge.y} L ${jx} ${pEdge.y}`;
  }
  if (Math.abs(pEdge.y - yc) <= STRAIGHT_Y_EPS) {
    return `M ${pEdge.x} ${pEdge.y} L ${jx} ${pEdge.y}`;
  }
  const span = Math.max(16, pEdge.x - jx);
  const ex = jx + span * 0.5;
  return `M ${pEdge.x} ${pEdge.y} L ${ex} ${yc} L ${jx} ${yc}`;
}

function polar(cx: number, cy: number, radius: number, angleDeg: number) {
  const rad = (Math.PI / 180) * angleDeg;
  return {
    x: cx + radius * Math.cos(-rad),
    y: cy + radius * Math.sin(-rad),
  };
}

function mathSign(n: number): number {
  if (n === 0) return 0;
  return n > 0 ? 1 : -1;
}

function allocationPieMidAngles(
  slices: { key: string; value: number }[],
  startAngle = PIE_START_ANGLE,
  endAngle = PIE_END_ANGLE,
  paddingAngle = ALLOCATION_PIE_PADDING_ANGLE
): { key: string; midAngle: number }[] {
  const deltaAngle = endAngle - startAngle;
  const absDelta = Math.abs(deltaAngle);
  const notZero = slices.filter((s) => s.value !== 0).length;
  const totalPadding = (absDelta >= 360 ? notZero : Math.max(0, notZero - 1)) * paddingAngle;
  const sum = slices.reduce((a, s) => a + (Number.isFinite(s.value) && s.value > 0 ? s.value : 0), 0);
  if (sum <= 0) return [];

  const realTotalAngle = absDelta - totalPadding;
  const out: { key: string; midAngle: number }[] = [];
  let prevEnd: number | undefined;

  slices.forEach((entry, i) => {
    const val = Number.isFinite(entry.value) && entry.value > 0 ? entry.value : 0;
    const pct = val / sum;
    const tempStart =
      i === 0
        ? startAngle
        : (prevEnd as number) + mathSign(deltaAngle) * paddingAngle * (val !== 0 ? 1 : 0);
    const tempEnd = tempStart + mathSign(deltaAngle) * pct * realTotalAngle;
    out.push({ key: entry.key, midAngle: (tempStart + tempEnd) / 2 });
    prevEnd = tempEnd;
  });

  return out;
}

function truncateName(name: string, maxChars: number): string {
  const t = name.trim() || '—';
  const limit = Math.max(4, maxChars);
  return t.length > limit ? `${t.slice(0, limit - 1)}\u2026` : t;
}

function maxLabelChars(maxPx: number, fontPx: number): number {
  const avgCharPx = fontPx * 0.52;
  return Math.max(4, Math.floor(maxPx / avgCharPx));
}

function allocationCalloutRendered(base: AllocationCalloutLayout) {
  const jx = base.pJoint.x;
  const yc = base.yCenter;
  const pathD = calloutPathD(base.side, base.pEdge, jx, yc);
  const tx = jx + base.sign * TEXT_PAD;
  const nameFont = LABEL_FONT_PX;
  const pctFont = Math.max(8, nameFont - 1);
  const nameLift = Math.max(4, Math.round(nameFont * 0.45));
  const pctDrop = Math.max(4, Math.round(nameFont * 0.58));
  return {
    pathD,
    tx,
    nameY: yc - nameLift,
    pctY: yc + pctDrop,
    anchor: base.anchor,
    displayName: base.displayName,
    pctLine: base.pctLine,
    nameFont,
    pctFont,
  };
}

/** Fixed Y centers for legend rows, top-aligned in the label band. */
function fixedLegendSlotYs(slotCount: number, minY: number, gap: number): number[] {
  if (slotCount <= 0) return [];
  return Array.from({ length: slotCount }, (_, i) => minY + i * gap);
}

/** Fit all non-dominant holdings on the left; compress row gap before dropping smallest labels. */
function planLeftLegendSlots(
  othersCount: number,
  minY: number,
  chartBottom: number
): { slotCount: number; gap: number; sliceFrom: number } {
  if (othersCount <= 0) {
    return { slotCount: 0, gap: LEGEND_SLOT_GAP, sliceFrom: 0 };
  }

  const available = Math.max(0, chartBottom - minY);
  const cappedCount = Math.min(othersCount, LEFT_LEGEND_SLOTS_MAX);
  let slotCount = cappedCount;
  let gap = LEGEND_SLOT_GAP;

  if (slotCount > 1) {
    const maxAtDefaultGap = Math.max(1, Math.floor(available / gap) + 1);
    if (slotCount > maxAtDefaultGap) {
      slotCount = maxAtDefaultGap;
      gap = Math.max(LEGEND_SLOT_GAP_MIN, available / (slotCount - 1));
      const maxAtMinGap = Math.max(1, Math.floor(available / gap) + 1);
      if (slotCount > maxAtMinGap) slotCount = maxAtMinGap;
    }
  }

  slotCount = Math.min(slotCount, cappedCount);
  const sliceFrom = Math.max(0, othersCount - slotCount);
  return { slotCount, gap, sliceFrom };
}

/**
 * Fixed-slot legend layout: largest holding on the right; others fill left slots with the
 * smallest at the top and larger holdings lower. Slot Y positions and column X stay constant.
 */
export function buildAllocationPieCalloutMap(
  width: number,
  height: number,
  slices: AllocationSliceRow[],
  margins: AllocationPieMargin = {
    top: ALLOCATION_PIE_CHART_MARGIN.top,
    right: ALLOCATION_PIE_CHART_MARGIN.right,
    bottom: ALLOCATION_PIE_CHART_MARGIN.bottom,
    left: ALLOCATION_PIE_CHART_MARGIN.left,
  }
): Map<string, AllocationCalloutLayout> {
  const result = new Map<string, AllocationCalloutLayout>();
  if (width < 64 || height < 64 || slices.length === 0) return result;

  const { top: mt, right: mr, bottom: mb, left: ml } = margins;
  const cw = width - ml - mr;
  const ch = height - mt - mb;
  if (cw < 32 || ch < 32) return result;

  const maxR = Math.min(cw, ch) / 2;
  const cx = ml + cw / 2;
  const cy = mt + ch / 2;
  const or = ALLOCATION_PIE_OUTER_RADIUS_FRAC * maxR;
  const pieLeft = cx - or;
  const pieRight = cx + or;

  const minY = Math.max(mt + LEFT_LEGEND_Y_OFFSET_PX, LABEL_FONT_PX + TEXT_PAD);

  const leftLabelGap = 76;
  const rightLabelGap = 58;
  const leftJointX = Math.max(ml + 36, pieLeft - leftLabelGap);
  const rightJointX = Math.min(width - mr - 48, pieRight + rightLabelGap);
  const leftTextMaxPx = leftJointX - TEXT_PAD - ml - LABEL_EDGE_PAD;
  const rightTextMaxPx = width - mr - LABEL_EDGE_PAD - (rightJointX + TEXT_PAD);

  const mids = allocationPieMidAngles(
    slices.map((s) => ({ key: s.key, value: s.value })),
    PIE_START_ANGLE,
    PIE_END_ANGLE,
    ALLOCATION_PIE_PADDING_ANGLE
  );
  const midByKey = new Map(mids.map((m) => [m.key, m.midAngle]));

  const ranked = [...slices].sort((a, b) => b.value - a.value);
  const dominant = ranked[0]!;
  const others = ranked.slice(1);
  const chartBottom = mt + ch - 8;
  const { slotCount, gap, sliceFrom } = planLeftLegendSlots(others.length, minY, chartBottom);
  const othersForLeft = others.slice(sliceFrom);
  const leftSlotYs = fixedLegendSlotYs(othersForLeft.length, minY, gap);

  const place = (
    sl: AllocationSliceRow,
    side: 'L' | 'R',
    yCenter: number,
    jointX: number,
    textMaxPx: number
  ) => {
    const midAngle = midByKey.get(sl.key);
    if (midAngle == null) return;
    const pEdge = polar(cx, cy, or, midAngle);
    const pKink = polar(cx, cy, or + RADIAL_STUB, midAngle);
    const sign: 1 | -1 = side === 'R' ? 1 : -1;
    const anchor: 'start' | 'end' = side === 'R' ? 'start' : 'end';
    const yc = side === 'R' ? pEdge.y : yCenter;
    result.set(sl.key, {
      pEdge,
      pKink,
      pJoint: { x: jointX, y: yc },
      yCenter: yc,
      side,
      sign,
      displayName: truncateName(sl.label, maxLabelChars(textMaxPx, LABEL_FONT_PX)),
      pctLine: formatPercentFi(sl.percent, 1),
      anchor,
    });
  };

  place(dominant, 'R', 0, rightJointX, rightTextMaxPx);
  [...othersForLeft].reverse().forEach((sl, i) => {
    const yCenter = leftSlotYs[i];
    if (yCenter == null) return;
    place(sl, 'L', yCenter, leftJointX, leftTextMaxPx);
  });

  return result;
}

const LINE_STROKE = 'rgba(96, 165, 250, 0.72)';

function renderOneCallout(sliceKey: string, base: AllocationCalloutLayout): ReactNode {
  const g = allocationCalloutRendered(base);

  return (
    <g key={sliceKey} className="allocation-pie-callout">
      <path
        d={g.pathD}
        fill="none"
        stroke={LINE_STROKE}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="miter"
        style={{ pointerEvents: 'none' }}
      />
      <text
        x={g.tx}
        y={g.nameY}
        textAnchor={g.anchor}
        dominantBaseline="middle"
        fill="#f4f4f5"
        stroke="rgba(29, 78, 216, 0.55)"
        strokeWidth={0.5}
        paintOrder="stroke fill"
        style={{ fontSize: g.nameFont, fontWeight: 600, pointerEvents: 'none', userSelect: 'none' }}
      >
        {g.displayName}
      </text>
      <text
        x={g.tx}
        y={g.pctY}
        textAnchor={g.anchor}
        dominantBaseline="middle"
        fill="#60a5fa"
        stroke="rgba(15, 23, 42, 0.65)"
        strokeWidth={0.4}
        paintOrder="stroke fill"
        style={{
          fontSize: g.pctFont,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        {g.pctLine}
      </text>
    </g>
  );
}

/** Render all fixed-slot callouts in one SVG layer. */
export function AllocationPieCalloutLayer({
  layout,
}: {
  layout: Map<string, AllocationCalloutLayout>;
}): ReactNode {
  if (layout.size === 0) return null;
  return (
    <g className="allocation-pie-callouts">
      {[...layout.entries()].map(([sliceKey, base]) => renderOneCallout(sliceKey, base))}
    </g>
  );
}

/** Pie `label` renderer — matches slices by index (Recharts 3 omits custom `key` from label props). */
export function createAllocationPieLabelRenderer(
  slices: AllocationSliceRow[],
  layout: Map<string, AllocationCalloutLayout>
): (props: PieLabelRenderProps) => ReactNode {
  return (props) => {
    const idx = props.index;
    if (typeof idx !== 'number' || idx < 0 || idx >= slices.length) return null;
    const slice = slices[idx]!;
    const base = layout.get(slice.key);
    if (!base) return null;
    return renderOneCallout(slice.key, base);
  };
}

export function allocationPieSliceKey(props: PieLabelRenderProps): string | null {
  const top = props as unknown as Record<string, unknown>;
  const pl = top.payload as Record<string, unknown> | undefined;
  if (pl && typeof pl.key === 'string' && pl.key.length > 0) return pl.key;
  if (typeof top.index === 'number' && pl && typeof pl.name === 'string') {
    const name = pl.name;
    if (name.length > 0) return name;
  }
  return null;
}

export function renderAllocationPieCalloutFromLayout(
  props: PieLabelRenderProps,
  layout: Map<string, AllocationCalloutLayout>
): ReactNode {
  const key = allocationPieSliceKey(props);
  if (key == null || key === 'empty') return null;
  const base = layout.get(key);
  if (!base) return null;

  return renderOneCallout(key, base);
}
