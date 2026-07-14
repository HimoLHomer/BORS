import { useEffect, useLayoutEffect, useRef, type SVGProps } from 'react';

/** Portfolio trend line — matches public/favicon.svg */
const TREND_PATH = 'M8 21.5 12.5 17 17 18.5 24 10.5';
const TREND_DRAW_MS = 400;

export function BorsMark({
  className,
  drawTrigger = 0,
  ...props
}: SVGProps<SVGSVGElement> & {
  /** Increment to replay the trend-line draw (~400ms). */
  drawTrigger?: number;
}) {
  const pathRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const pathLenRef = useRef(0);

  useLayoutEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    const len = path.getTotalLength();
    pathLenRef.current = len;
    path.style.strokeDasharray = `${len}`;
    path.style.strokeDashoffset = '0';
  }, []);

  useEffect(() => {
    if (drawTrigger === 0) return;
    const path = pathRef.current;
    const dot = dotRef.current;
    if (!path) return;

    const len = pathLenRef.current || path.getTotalLength();
    path.style.transition = 'none';
    path.style.strokeDashoffset = `${len}`;
    if (dot) {
      dot.style.transition = 'none';
      dot.style.opacity = '0';
    }

    void path.getBoundingClientRect();

    path.style.transition = `stroke-dashoffset ${TREND_DRAW_MS}ms ease-out`;
    path.style.strokeDashoffset = '0';
    if (dot) {
      dot.style.transition = `opacity 160ms ease-out ${TREND_DRAW_MS - 100}ms`;
      dot.style.opacity = '1';
    }
  }, [drawTrigger]);

  return (
    <svg
      className={className ? `block ${className}` : 'block'}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...props}
    >
      <rect width="32" height="32" rx="7" fill="#18181b" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="6.5" stroke="#27272a" />
      <path
        ref={pathRef}
        d={TREND_PATH}
        stroke="#3b82f6"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle ref={dotRef} cx="24" cy="10.5" r="1.75" fill="#3b82f6" />
    </svg>
  );
}
