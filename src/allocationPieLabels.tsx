import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { PieLabelRenderProps } from 'recharts';

/** Must match default <PieChart margin> for the allocation card (before pie nudge). */
export const ALLOCATION_PIE_CHART_MARGIN = { top: 28, right: 48, bottom: 28, left: 48 } as const;
export const ALLOCATION_PIE_OUTER_RADIUS_FRAC = 0.58;
export const ALLOCATION_LABEL_OFFSETS_STORAGE_KEY = 'bors_allocation_callout_offsets_v1';
export const ALLOCATION_CHROME_STORAGE_KEY = 'bors_allocation_chrome_v1';

export type AllocationPieMargin = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type AllocationChromePrefs = {
  pieNudgeX: number;
  pieNudgeY: number;
  labelFontPx: number;
};

const CHROME_DEFAULTS: AllocationChromePrefs = { pieNudgeX: 0, pieNudgeY: 0, labelFontPx: 11 };

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function loadAllocationChromePrefs(): AllocationChromePrefs {
  try {
    const raw = localStorage.getItem(ALLOCATION_CHROME_STORAGE_KEY);
    if (!raw) return { ...CHROME_DEFAULTS };
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      pieNudgeX: clampNum(o.pieNudgeX, -120, 120, CHROME_DEFAULTS.pieNudgeX),
      pieNudgeY: clampNum(o.pieNudgeY, -120, 120, CHROME_DEFAULTS.pieNudgeY),
      labelFontPx: clampNum(o.labelFontPx, 8, 18, CHROME_DEFAULTS.labelFontPx),
    };
  } catch {
    return { ...CHROME_DEFAULTS };
  }
}

export function saveAllocationChromePrefs(prefs: AllocationChromePrefs): void {
  try {
    localStorage.setItem(ALLOCATION_CHROME_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

/** Clamp nudge so margins stay ≥ 8px on each side. */
export function allocationPieMarginsWithNudge(
  base: typeof ALLOCATION_PIE_CHART_MARGIN,
  nudgeX: number,
  nudgeY: number
): AllocationPieMargin {
  const maxNx = Math.min(100, base.left - 8, base.right - 8);
  const maxNy = Math.min(100, base.top - 8, base.bottom - 8);
  const nx = Math.min(maxNx, Math.max(-maxNx, nudgeX));
  const ny = Math.min(maxNy, Math.max(-maxNy, nudgeY));
  return {
    top: base.top + ny,
    bottom: base.bottom - ny,
    left: base.left + nx,
    right: base.right - nx,
  };
}

const RADIAL_STUB = 18;
const HORIZ_ARM = 58;
const TEXT_PAD = 8;
const MIN_STACK_GAP = 38;
const NAME_MAX_LEN = 28;

export type AllocationSliceRow = { key: string; name: string; value: number; percent: number };

/** Base geometry before user drag offset (dx, dy). */
export type AllocationCalloutLayout = {
  pEdge: { x: number; y: number };
  pKink: { x: number; y: number };
  pJoint: { x: number; y: number };
  yCenter: number;
  sign: 1 | -1;
  displayName: string;
  pctLine: string;
  anchor: 'start' | 'end';
};

export type AllocationLabelOffset = { dx: number; dy: number };

export function loadAllocationLabelOffsets(): Record<string, AllocationLabelOffset> {
  try {
    const raw = localStorage.getItem(ALLOCATION_LABEL_OFFSETS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, AllocationLabelOffset> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!v || typeof v !== 'object') continue;
      const o = v as { dx?: unknown; dy?: unknown };
      const dx = typeof o.dx === 'number' && Number.isFinite(o.dx) ? o.dx : 0;
      const dy = typeof o.dy === 'number' && Number.isFinite(o.dy) ? o.dy : 0;
      if (dx !== 0 || dy !== 0) out[k] = { dx, dy };
    }
    return out;
  } catch {
    return {};
  }
}

export function saveAllocationLabelOffsets(offsets: Record<string, AllocationLabelOffset>): void {
  try {
    localStorage.setItem(ALLOCATION_LABEL_OFFSETS_STORAGE_KEY, JSON.stringify(offsets));
  } catch {
    /* ignore */
  }
}

function mathSign(n: number): number {
  if (n === 0) return 0;
  return n > 0 ? 1 : -1;
}

function polar(cx: number, cy: number, radius: number, angleDeg: number) {
  const rad = (Math.PI / 180) * angleDeg;
  return {
    x: cx + radius * Math.cos(-rad),
    y: cy + radius * Math.sin(-rad),
  };
}

function allocationPieMidAngles(
  slices: { key: string; value: number }[],
  startAngle = 90,
  endAngle = -270,
  paddingAngle = 0.6,
  minAngle = 0
): { key: string; midAngle: number }[] {
  const deltaAngle = endAngle - startAngle;
  const absDelta = Math.abs(deltaAngle);
  const notZero = slices.filter((s) => s.value !== 0).length;
  const totalPadding = (absDelta >= 360 ? notZero : Math.max(0, notZero - 1)) * paddingAngle;
  const sum = slices.reduce((a, s) => a + (Number.isFinite(s.value) && s.value > 0 ? s.value : 0), 0);
  if (sum <= 0) return [];

  const needsMin =
    minAngle > 0 &&
    slices.some((entry) => {
      const v = Number.isFinite(entry.value) && entry.value > 0 ? entry.value : 0;
      return v !== 0 && (v / sum) * absDelta < minAngle;
    });
  const effectiveMinAngle = needsMin ? minAngle : 0;
  const realTotalAngle = absDelta - notZero * effectiveMinAngle - totalPadding;

  const out: { key: string; midAngle: number }[] = [];
  let prevEnd: number | undefined;

  slices.forEach((entry, i) => {
    const val = Number.isFinite(entry.value) && entry.value > 0 ? entry.value : 0;
    const pct = val / sum;
    const tempStart =
      i === 0
        ? startAngle
        : (prevEnd as number) + mathSign(deltaAngle) * paddingAngle * (val !== 0 ? 1 : 0);
    const tempEnd =
      tempStart + mathSign(deltaAngle) * ((val !== 0 ? effectiveMinAngle : 0) + pct * realTotalAngle);
    out.push({ key: entry.key, midAngle: (tempStart + tempEnd) / 2 });
    prevEnd = tempEnd;
  });

  return out;
}

function truncateName(name: string): string {
  const t = name.trim() || '—';
  return t.length > NAME_MAX_LEN ? `${t.slice(0, NAME_MAX_LEN - 2)}\u2026` : t;
}

function stackNaturalCenters(
  items: { key: string; yCenter: number }[],
  minY: number,
  maxY: number,
  gap: number
): Map<string, number> {
  const map = new Map<string, number>();
  if (items.length === 0) return map;
  const sorted = [...items].sort((a, b) => a.yCenter - b.yCenter);
  const assigned = sorted.map((s) => s.yCenter);

  for (let i = 1; i < assigned.length; i++) {
    assigned[i] = Math.max(sorted[i].yCenter, assigned[i - 1] + gap);
  }

  if (assigned[assigned.length - 1] > maxY) {
    assigned[assigned.length - 1] = maxY;
    for (let i = assigned.length - 2; i >= 0; i--) {
      assigned[i] = Math.min(assigned[i], assigned[i + 1] - gap);
    }
  }

  if (assigned[0] < minY) {
    assigned[0] = minY;
    for (let i = 1; i < assigned.length; i++) {
      assigned[i] = Math.max(assigned[i], assigned[i - 1] + gap);
    }
  }

  sorted.forEach((s, i) => map.set(s.key, assigned[i]));
  return map;
}

export function allocationCalloutRendered(
  base: AllocationCalloutLayout,
  dx: number,
  dy: number,
  labelFontPx: number
) {
  const jx = base.pJoint.x + dx;
  const jy = base.pJoint.y + dy;
  const yc = base.yCenter + dy;
  const pathD = `M ${base.pEdge.x} ${base.pEdge.y} L ${base.pKink.x} ${base.pKink.y} L ${jx} ${jy} L ${jx} ${yc}`;
  const tx = jx + base.sign * TEXT_PAD;
  const nameFont = Math.round(Math.min(18, Math.max(8, labelFontPx)));
  const pctFont = Math.max(8, nameFont - 1);
  const nameLift = Math.max(5, Math.round(nameFont * 0.58));
  const pctDrop = Math.max(6, Math.round(nameFont * 0.82));
  const nameY = yc - nameLift;
  const pctY = yc + pctDrop;
  return {
    pathD,
    tx,
    nameY,
    pctY,
    anchor: base.anchor,
    displayName: base.displayName,
    pctLine: base.pctLine,
    nameFont,
    pctFont,
  };
}

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

  const mids = allocationPieMidAngles(
    slices.map((s) => ({ key: s.key, value: s.value })),
    90,
    -270,
    0.6,
    0
  );
  const midByKey = new Map(mids.map((m) => [m.key, m.midAngle]));

  type Nom = {
    key: string;
    side: 'L' | 'R';
    yNat: number;
    pEdge: { x: number; y: number };
    pKink: { x: number; y: number };
    sign: 1 | -1;
    pJoint: { x: number; y: number };
    displayName: string;
    pctLine: string;
  };

  const noms: Nom[] = [];
  for (const sl of slices) {
    const midAngle = midByKey.get(sl.key);
    if (midAngle == null) continue;
    const pEdge = polar(cx, cy, or, midAngle);
    const pKink = polar(cx, cy, or + RADIAL_STUB, midAngle);
    const outwardRight = pKink.x >= cx;
    const sign: 1 | -1 = outwardRight ? 1 : -1;
    const pJoint = { x: pKink.x + sign * HORIZ_ARM, y: pKink.y };
    noms.push({
      key: sl.key,
      side: outwardRight ? 'R' : 'L',
      yNat: pJoint.y,
      pEdge,
      pKink,
      sign,
      pJoint,
      displayName: truncateName(sl.name),
      pctLine: `${sl.percent.toFixed(1)}% of portfolio`,
    });
  }

  const padY = 22;
  const minY = mt + padY;
  const maxY = height - mb - padY;

  const left = noms.filter((n) => n.side === 'L').map((n) => ({ key: n.key, yCenter: n.yNat }));
  const right = noms.filter((n) => n.side === 'R').map((n) => ({ key: n.key, yCenter: n.yNat }));
  const yLeft = stackNaturalCenters(left, minY, maxY, MIN_STACK_GAP);
  const yRight = stackNaturalCenters(right, minY, maxY, MIN_STACK_GAP);

  for (const n of noms) {
    const yCenter = (n.side === 'L' ? yLeft : yRight).get(n.key) ?? n.yNat;
    const anchor: 'start' | 'end' = n.sign === 1 ? 'start' : 'end';
    result.set(n.key, {
      pEdge: n.pEdge,
      pKink: n.pKink,
      pJoint: n.pJoint,
      yCenter,
      sign: n.sign,
      displayName: n.displayName,
      pctLine: n.pctLine,
      anchor,
    });
  }

  return result;
}

const LINE_STROKE = 'rgba(255,255,255,0.42)';
const HIT_STROKE = 'rgba(255,255,255,0.012)';

export function allocationPieSliceKey(props: PieLabelRenderProps): string | null {
  const top = props as unknown as Record<string, unknown>;
  if (typeof top.key === 'string' && top.key.length > 0) return top.key;
  const pl = top.payload as Record<string, unknown> | undefined;
  if (pl && typeof pl.key === 'string' && pl.key.length > 0) return pl.key;
  return null;
}

export function allocationCalloutFromLabelProps(props: PieLabelRenderProps): AllocationCalloutLayout | null {
  const { cx, cy, midAngle, outerRadius, percent, payload, name } = props;
  if (cx == null || cy == null || midAngle == null || typeof outerRadius !== 'number') return null;
  const pl = payload as { name?: string; percent?: number } | undefined;
  const pct =
    typeof pl?.percent === 'number'
      ? pl.percent
      : typeof percent === 'number'
        ? percent * 100
        : 0;
  const displayName = truncateName(String(pl?.name ?? name ?? '—'));
  const pctLine = `${pct.toFixed(1)}% of portfolio`;

  const pEdge = polar(cx, cy, outerRadius, midAngle);
  const pKink = polar(cx, cy, outerRadius + RADIAL_STUB, midAngle);
  const outwardRight = pKink.x >= cx;
  const sign: 1 | -1 = outwardRight ? 1 : -1;
  const pJoint = { x: pKink.x + sign * HORIZ_ARM, y: pKink.y };
  const yCenter = pJoint.y;
  const anchor: 'start' | 'end' = sign === 1 ? 'start' : 'end';
  return {
    pEdge,
    pKink,
    pJoint,
    yCenter,
    sign,
    displayName,
    pctLine,
    anchor,
  };
}

export function renderAllocationPieCalloutFromLayout(
  props: PieLabelRenderProps,
  layout: Map<string, AllocationCalloutLayout>,
  offsets: Readonly<Record<string, AllocationLabelOffset | undefined>>,
  opts: {
    draggingKey: string | null;
    onPointerDown: (sliceKey: string, e: ReactPointerEvent<SVGGElement>) => void;
    labelFontPx: number;
  }
): ReactNode {
  const key = allocationPieSliceKey(props);
  if (key == null || key === 'empty') return null;
  const base = layout.get(key) ?? allocationCalloutFromLabelProps(props);
  if (!base) return null;

  const off = offsets[key] ?? { dx: 0, dy: 0 };
  const g = allocationCalloutRendered(base, off.dx, off.dy, opts.labelFontPx);
  const dragging = opts.draggingKey === key;

  return (
    <g
      className="allocation-pie-callout"
      style={{ cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none', userSelect: 'none' }}
      onPointerDown={(e) => opts.onPointerDown(key, e)}
    >
      <path
        d={g.pathD}
        fill="none"
        stroke={HIT_STROKE}
        strokeWidth={14}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ pointerEvents: 'stroke' }}
      />
      <path
        d={g.pathD}
        fill="none"
        stroke={LINE_STROKE}
        strokeWidth={1}
        strokeLinecap="round"
        strokeLinejoin="miter"
        style={{ pointerEvents: 'none' }}
      />
      <text
        x={g.tx}
        y={g.nameY}
        textAnchor={g.anchor}
        dominantBaseline="middle"
        fill="#ffffff"
        stroke="rgba(0, 17, 55, 0.5)"
        strokeWidth={0.4}
        paintOrder="stroke fill"
        style={{ fontSize: g.nameFont, fontWeight: 700, pointerEvents: 'none', userSelect: 'none' }}
      >
        {g.displayName}
      </text>
      <text
        x={g.tx}
        y={g.pctY}
        textAnchor={g.anchor}
        dominantBaseline="middle"
        fill="rgba(255, 255, 255, 0.9)"
        stroke="rgba(0, 17, 55, 0.45)"
        strokeWidth={0.35}
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
