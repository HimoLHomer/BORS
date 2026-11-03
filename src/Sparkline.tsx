import { useId } from 'react';

/**
 * Small trend line for a table row: soft fill, green/red against the previous close, and a
 * glowing dot on the latest price.
 */
export function Sparkline({
  points,
  previousClose,
  width = 96,
  height = 30,
}: {
  points: number[];
  previousClose?: number | null;
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
  const x = (i: number) => pad + (i * (width - pad * 2)) / (points.length - 1);
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
