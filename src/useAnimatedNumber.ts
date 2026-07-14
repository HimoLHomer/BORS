import { useEffect, useRef, useState } from 'react';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Smooth count toward a numeric target (EUR totals, etc.). */
export function useAnimatedNumber(
  value: number,
  options?: { durationMs?: number; minDelta?: number }
): number {
  const durationMs = options?.durationMs ?? 320;
  const minDelta = options?.minDelta ?? 50;
  const [display, setDisplay] = useState(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (prefersReducedMotion() || Math.abs(value - display) < minDelta) {
      setDisplay(value);
      return;
    }

    const from = display;
    const start = performance.now();
    const delta = value - from;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - t) ** 3;
      setDisplay(from + delta * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- animate from last display
  }, [value, durationMs, minDelta]);

  return display;
}
