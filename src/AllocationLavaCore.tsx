/**
 * A toy for the allocation donut's hole: soft blobs of light in the slices' colours drift
 * through it like a lava lamp, blending like light as the app's glows do. The pointer stirs them,
 * a click sends out a ripple that scatters them, and the hovered slice's blobs brighten.
 * Purely decorative; the animation pauses while off screen and respects reduced motion.
 */
import React, { useEffect, useRef } from 'react';

type Rgb = [number, number, number];

type Blob = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Radius, as a share of the hole's radius. */
  r: number;
  /** Index into the slice colours. */
  colour: number;
  phase: number;
};

type Ripple = { x: number; y: number; born: number };

const BLOB_COUNT = 9;
/** Blobs drift freely inside this radius and are pulled back beyond it. */
const DRIFT_R = 0.58;
const POINTER_REACH = 0.55;
const RIPPLE_LIFE_S = 1.4;
const FALLBACK_RGB: Rgb = [59, 130, 246];

/** A slice colour (hex, or a `var(--token)` from the theme) as RGB. */
function resolveRgb(css: string): Rgb {
  let value = css.trim();
  const token = /^var\((--[\w-]+)\)$/.exec(value);
  if (token) value = getComputedStyle(document.documentElement).getPropertyValue(token[1]!).trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.[1];
  if (!hex) return FALLBACK_RGB;
  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
}

/**
 * Every visible slice gets one blob; the rest go to the slices by share, so a portfolio that is
 * mostly one fund glows mostly that fund's colour. Bigger shares make bigger blobs.
 */
function makeBlobs(shares: number[], previous: Blob[]): Blob[] {
  const counts = shares.map((s) => (s >= 1 ? 1 : 0));
  let left = BLOB_COUNT - counts.reduce((a, b) => a + b, 0);
  const total = shares.reduce((a, b) => a + b, 0) || 1;
  while (left > 0) {
    // The slice furthest below its fair number of blobs gets the next one.
    let best = 0;
    let bestGap = -Infinity;
    shares.forEach((s, i) => {
      const gap = (s / total) * BLOB_COUNT - counts[i]!;
      if (gap > bestGap) {
        bestGap = gap;
        best = i;
      }
    });
    counts[best]!++;
    left--;
  }
  const blobs: Blob[] = [];
  counts.forEach((n, colour) => {
    for (let k = 0; k < n; k++) {
      // Keep blobs that already exist where they are, so price ticks don't reset the lamp.
      const old = previous[blobs.length];
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * DRIFT_R;
      blobs.push({
        x: old?.x ?? Math.cos(angle) * dist,
        y: old?.y ?? Math.sin(angle) * dist,
        vx: old?.vx ?? 0,
        vy: old?.vy ?? 0,
        r: 0.3 + 0.28 * Math.sqrt(shares[colour]! / total),
        colour,
        phase: old?.phase ?? Math.random() * Math.PI * 2,
      });
    }
  });
  return blobs;
}

export function AllocationLavaCore({
  colours,
  shares,
  highlight,
  diameterPercent,
  onPoke,
}: {
  /** Called on each click, so the ring around can answer the ripple. */
  onPoke?: () => void;
  /** Diameter as a share of the chart's square box, so the canvas fills the donut's hole. */
  diameterPercent: number;
  /** Slice colours, as the donut draws them. */
  colours: string[];
  /** Slice shares in percent, in the same order. */
  shares: number[];
  /** Index of the hovered slice: its blobs brighten and the others fade. */
  highlight: number | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blobsRef = useRef<Blob[]>([]);
  const rgbRef = useRef<Rgb[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const highlightRef = useRef<number | null>(highlight);
  highlightRef.current = highlight;

  // Re-deal colours only when the slices change, not on every price tick.
  const colourKey = colours.join('|') + '#' + shares.map((s) => Math.round(s)).join(',');
  useEffect(() => {
    rgbRef.current = colours.map(resolveRgb);
    blobsRef.current = makeBlobs(shares, blobsRef.current);
  }, [colourKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let size = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size = canvas.clientWidth;
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let visible = true;
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    io.observe(canvas);

    // Smoothed per-slice brightness, so hovering fades in rather than snapping.
    const glow: number[] = [];

    const step = (t: number, dt: number) => {
      const pointer = pointerRef.current;
      const blobs = blobsRef.current;
      for (const b of blobs) {
        // A slow, swirling current, different for every blob, on top of a gentle orbit.
        let ax = Math.sin(t * 0.31 + b.phase + b.y * 2.2) * 0.16 - b.y * 0.22;
        let ay = Math.cos(t * 0.27 + b.phase * 1.3 + b.x * 2.2) * 0.16 + b.x * 0.22;
        // Blobs keep a little apart, so the light spreads through the hole instead of pooling.
        for (const o of blobs) {
          if (o === b) continue;
          const dx = b.x - o.x;
          const dy = b.y - o.y;
          const dist = Math.hypot(dx, dy) || 0.001;
          const reach = (b.r + o.r) * 0.7;
          if (dist < reach) {
            ax += (dx / dist) * (reach - dist) * 1.2;
            ay += (dy / dist) * (reach - dist) * 1.2;
          }
        }
        const d = Math.hypot(b.x, b.y);
        if (d > DRIFT_R) {
          ax -= (b.x / d) * (d - DRIFT_R) * 3.2;
          ay -= (b.y / d) * (d - DRIFT_R) * 3.2;
        }
        if (pointer) {
          // The pointer pushes blobs aside, like a finger through warm wax.
          const dx = b.x - pointer.x;
          const dy = b.y - pointer.y;
          const dist = Math.hypot(dx, dy) || 0.001;
          if (dist < POINTER_REACH) {
            const push = (POINTER_REACH - dist) * 2.6;
            ax += (dx / dist) * push;
            ay += (dy / dist) * push;
          }
        }
        const damping = Math.exp(-1.4 * dt);
        b.vx = (b.vx + ax * dt) * damping;
        b.vy = (b.vy + ay * dt) * damping;
        const speed = Math.hypot(b.vx, b.vy);
        if (speed > 1.6) {
          b.vx *= 1.6 / speed;
          b.vy *= 1.6 / speed;
        }
        b.x += b.vx * dt;
        b.y += b.vy * dt;
      }
      ripplesRef.current = ripplesRef.current.filter((r) => t - r.born < RIPPLE_LIFE_S);
    };

    const draw = (t: number, dt: number) => {
      const half = size / 2;
      ctx.clearRect(0, 0, size, size);
      // Screen blending: overlaps brighten like light, without blowing out to white.
      ctx.globalCompositeOperation = 'screen';
      const rgb = rgbRef.current;
      const hl = highlightRef.current;
      for (let i = 0; i < rgb.length; i++) {
        const target = hl == null ? 1 : hl === i ? 1.9 : 0.35;
        glow[i] = (glow[i] ?? 1) + (target - (glow[i] ?? 1)) * Math.min(1, dt * 8);
      }
      for (const b of blobsRef.current) {
        const [r, g, bl] = rgb[b.colour] ?? FALLBACK_RGB;
        const a = Math.min(0.85, 0.42 * (glow[b.colour] ?? 1));
        // A gentle breathing in size.
        const radius = b.r * half * (1 + 0.08 * Math.sin(t * 0.9 + b.phase));
        const cx = half + b.x * half;
        const cy = half + b.y * half;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        grad.addColorStop(0, `rgba(${r},${g},${bl},${a})`);
        grad.addColorStop(0.5, `rgba(${r},${g},${bl},${a * 0.5})`);
        grad.addColorStop(1, `rgba(${r},${g},${bl},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      // A faint light that follows the pointer.
      const pointer = pointerRef.current;
      if (pointer) {
        const px = half + pointer.x * half;
        const py = half + pointer.y * half;
        const grad = ctx.createRadialGradient(px, py, 0, px, py, half * 0.32);
        grad.addColorStop(0, 'rgba(191,212,254,0.16)');
        grad.addColorStop(1, 'rgba(191,212,254,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(px, py, half * 0.32, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const ripple of ripplesRef.current) {
        const age = (t - ripple.born) / RIPPLE_LIFE_S;
        ctx.strokeStyle = `rgba(147,183,253,${0.55 * (1 - age) ** 2})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(half + ripple.x * half, half + ripple.y * half, age * half * 1.1, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Fade everything out toward the rim, so the light sits inside the ring like a soft orb.
      ctx.globalCompositeOperation = 'destination-in';
      const mask = ctx.createRadialGradient(half, half, half * 0.55, half, half, half);
      mask.addColorStop(0, 'rgba(0,0,0,1)');
      mask.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = mask;
      ctx.fillRect(0, 0, size, size);
      ctx.globalCompositeOperation = 'source-over';
    };

    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (!visible || document.hidden || size <= 0) return;
      const t = now / 1000;
      step(t, dt);
      draw(t, dt);
    };
    if (reducedMotion) {
      draw(performance.now() / 1000, 1);
    } else {
      frame = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  /** Pointer position in the hole's own units: the centre is 0, the rim is 1. */
  const toUnit = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: ((e.clientY - rect.top) / rect.height) * 2 - 1,
    };
  };

  return (
    <canvas
      ref={canvasRef}
      className="absolute left-1/2 top-1/2 z-[1] aspect-square -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full"
      style={{ width: `${diameterPercent}%` }}
      onPointerMove={(e) => {
        pointerRef.current = toUnit(e);
      }}
      onPointerLeave={() => {
        pointerRef.current = null;
      }}
      onPointerDown={(e) => {
        const p = toUnit(e);
        const t = performance.now() / 1000;
        ripplesRef.current.push({ x: p.x, y: p.y, born: t });
        onPoke?.();
        // Scatter the blobs away from the click.
        for (const b of blobsRef.current) {
          const dx = b.x - p.x;
          const dy = b.y - p.y;
          const dist = Math.hypot(dx, dy) || 0.001;
          const kick = 1.5 * Math.max(0, 1.2 - dist);
          b.vx += (dx / dist) * kick;
          b.vy += (dy / dist) * kick;
        }
      }}
      aria-hidden
    />
  );
}
