import { useId } from 'react';

/**
 * Small trend line for a table row: soft fill, green/red against the previous close, and a
 * glowing dot on the latest price. With `times` and `domain` (epoch ms) points sit at their
 * time, so a session still in progress fills only part of the width.
 */
export function Sparkline({
  points,
  previousClose,
  times,
  domain,
  width = 96,
  height = 30,
}: {
  points: number[];
  previousClose?: number | null;
  times?: number[];
  domain?: [number, number];
  width?: number;
  height?: number;
}) {
  const gradientId = `spark-${useId().replace(/:/g, '')}`;
  if (points.length < 2) return <span className="text-text-t text-xs">—</span>;

  const last = points[points.length - 1]!;
  const reference = previousClose ?? points[0]!;
  const up = last >= reference;
  const color = up ? 'var(--color-green)' : 'var(--color-red)';

  const pad = 4;
  const min = Math.min(...points, reference);
  const max = Math.max(...points, reference);
  const span = max - min || 1;
  const timed = times != null && times.length === points.length && domain != null && domain[1] > domain[0];
  const x = (i: number) => {
    const frac = timed
      ? Math.min(1, Math.max(0, (times[i]! - domain[0]) / (domain[1] - domain[0])))
      : i / (points.length - 1);
    return pad + frac * (width - pad * 2);
  };
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);

  const line = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`;
  const endX = x(points.length - 1);
  const endY = y(last);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="overflow-visible">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <line
        x1={pad}
        x2={width - pad}
        y1={y(reference)}
        y2={y(reference)}
        stroke="rgb(255 255 255 / 0.12)"
        strokeDasharray="2 3"
      />
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={endX} cy={endY} r={5} fill={color} opacity={0.22} />
      <circle cx={endX} cy={endY} r={2.4} fill={color} />
    </svg>
  );
}

/** A holding's sparkline as served by `/api/portfolio/sparklines`. */
export type HoldingSparklineData = {
  points: number[];
  times?: number[];
  sessionStart?: number;
  sessionEnd?: number;
  previousClose: number | null;
};

/**
 * Sparkline props for a holding, aligned with the live quote: the 5-minute bars lag the quote
 * (and miss closing auctions), so the line ends on the live price and is measured against the
 * quote's previous close, the same move the Today gain column shows.
 */
export function sparklineWithLiveQuote(
  data: HoldingSparklineData,
  livePrice: number | null,
  changePercent: number | undefined,
  now: number = Date.now()
): { points: number[]; previousClose: number | null; times?: number[]; domain?: [number, number] } {
  const { sessionStart, sessionEnd } = data;
  const domain: [number, number] | undefined =
    sessionStart != null && sessionEnd != null && sessionEnd > sessionStart ? [sessionStart, sessionEnd] : undefined;
  let points = data.points;
  let times = data.times && data.times.length === points.length ? data.times : undefined;
  let previousClose = data.previousClose;

  if (livePrice != null && livePrice > 0) {
    if (changePercent != null && Number.isFinite(changePercent) && changePercent > -100) {
      previousClose = livePrice / (1 + changePercent / 100);
    }
    const lastTime = times?.[times.length - 1];
    if (times && domain && lastTime != null) {
      const t = Math.min(Math.max(now, lastTime), domain[1]);
      if (t > lastTime) {
        points = [...points, livePrice];
        times = [...times, t];
      } else {
        points = [...points.slice(0, -1), livePrice];
      }
    } else {
      points = [...points.slice(0, -1), livePrice];
    }
  }

  return { points, previousClose, times, domain };
}
