import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

const TOOLTIP_WIDTH = 288;
const GAP = 8;
const EDGE = 8;

/**
 * Small "i" icon that explains a figure on hover or keyboard focus. The tooltip is portalled
 * to <body> with fixed positioning so panels with overflow-hidden do not clip it.
 */
export function InfoHint({ children, label = 'More info' }: { children: React.ReactNode; label?: string }) {
  const tooltipId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const btn = buttonRef.current?.getBoundingClientRect();
    const tipHeight = tooltipRef.current?.offsetHeight ?? 0;
    if (!btn) return;
    const left = Math.min(
      Math.max(EDGE, btn.left + btn.width / 2 - TOOLTIP_WIDTH / 2),
      window.innerWidth - TOOLTIP_WIDTH - EDGE
    );
    const below = btn.bottom + GAP;
    const top = below + tipHeight > window.innerHeight - EDGE ? btn.top - GAP - tipHeight : below;
    setPos({ left, top: Math.max(EDGE, top) });
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full align-middle text-text-s/50 transition-colors hover:text-accent focus-visible:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open &&
        createPortal(
          <div
            ref={tooltipRef}
            id={tooltipId}
            role="tooltip"
            style={{
              left: pos?.left ?? 0,
              top: pos?.top ?? 0,
              width: TOOLTIP_WIDTH,
              visibility: pos ? 'visible' : 'hidden',
            }}
            className="pointer-events-none fixed z-[100] rounded-lg border border-white/15 bg-[#0c0c0e]/95 px-3 py-2.5 text-left text-xs font-normal normal-case tracking-normal leading-relaxed text-text-s shadow-xl backdrop-blur-sm [&_strong]:font-semibold [&_strong]:text-text-p [&_p+p]:mt-1.5"
          >
            {children}
          </div>,
          document.body
        )}
    </>
  );
}
