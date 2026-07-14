import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { formatDateEn, parseIsoDateOnly, todayIsoDateHelsinki } from './formatDate';
import { MARKET_SUBCARD } from './marketTheme';

const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;
const POPOVER_GAP = 8;
const POPOVER_Z = 200;

function parseViewMonth(value: string): { year: number; month: number } {
  const today = todayIsoDateHelsinki();
  const iso = value.trim() || today;
  const d = parseIsoDateOnly(iso);
  if (!d) {
    const [y, m] = today.split('-').map(Number);
    return { year: y, month: m };
  }
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
    new Date(Date.UTC(year, month - 1, 1))
  );
}

type CalendarCell = {
  day: number;
  iso: string;
  inMonth: boolean;
};

function buildMonthGrid(year: number, month: number): CalendarCell[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstDow = (first.getUTCDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prevMonthDays = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();

  const cells: CalendarCell[] = [];
  for (let i = firstDow - 1; i >= 0; i--) {
    const day = prevMonthDays - i;
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    cells.push({ day, iso: toIsoDate(prevYear, prevMonth, day), inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ day, iso: toIsoDate(year, month, day), inMonth: true });
  }
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  let trailingDay = 1;
  while (cells.length % 7 !== 0) {
    cells.push({
      day: trailingDay,
      iso: toIsoDate(nextYear, nextMonth, trailingDay),
      inMonth: false,
    });
    trailingDay += 1;
  }
  return cells;
}

type PopoverLayout = {
  top: number;
  left: number;
  width: number;
  placement: 'below' | 'above';
};

function computePopoverLayout(trigger: HTMLElement, popoverHeight: number): PopoverLayout {
  const rect = trigger.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom - POPOVER_GAP;
  const spaceAbove = rect.top - POPOVER_GAP;
  const placeAbove = spaceBelow < popoverHeight && spaceAbove > spaceBelow;

  return {
    left: rect.left,
    width: rect.width,
    top: placeAbove ? rect.top - POPOVER_GAP : rect.bottom + POPOVER_GAP,
    placement: placeAbove ? 'above' : 'below',
  };
}

export function ThemeDatePicker({
  value,
  onChange,
  disabled = false,
  className = '',
  placeholder = 'Select date…',
}: {
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [layout, setLayout] = useState<PopoverLayout | null>(null);
  const [{ year, month }, setView] = useState(() => parseViewMonth(value));

  const updateLayout = useCallback(() => {
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger) return;
    const height = popover?.offsetHeight ?? 320;
    setLayout(computePopoverLayout(trigger, height));
  }, []);

  useEffect(() => {
    if (!open) return;
    setView(parseViewMonth(value));
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    updateLayout();
    const onScrollOrResize = () => updateLayout();
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open, updateLayout, year, month]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const cells = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const today = todayIsoDateHelsinki();

  const shiftMonth = (delta: number) => {
    setView(({ year, month }) => {
      let m = month + delta;
      let y = year;
      while (m < 1) {
        m += 12;
        y -= 1;
      }
      while (m > 12) {
        m -= 12;
        y += 1;
      }
      return { year: y, month: m };
    });
  };

  const display = value.trim() ? formatDateEn(value) : placeholder;

  const calendarPanel = (
    <AnimatePresence>
      {open && !disabled && layout && (
        <div
          style={{
            position: 'fixed',
            top: layout.top,
            left: layout.left,
            width: layout.width,
            zIndex: POPOVER_Z,
            transform: layout.placement === 'above' ? 'translateY(-100%)' : undefined,
          }}
        >
          <motion.div
            ref={popoverRef}
            initial={{ opacity: 0, y: layout.placement === 'below' ? -6 : 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: layout.placement === 'below' ? -6 : 6 }}
            className={`${MARKET_SUBCARD} bg-card border-border/60 shadow-2xl p-3`}
          >
          <div className="flex items-center justify-between gap-2 mb-3">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="p-1.5 rounded-lg text-text-s hover:text-text-p hover:bg-white/5 transition-colors"
              aria-label="Previous month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-bold uppercase tracking-widest text-text-p">{monthLabel(year, month)}</span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="p-1.5 rounded-lg text-text-s hover:text-text-p hover:bg-white/5 transition-colors"
              aria-label="Next month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAY_LABELS.map((d) => (
              <div
                key={d}
                className="text-center text-[10px] font-bold uppercase tracking-wider text-text-s/60 py-1"
              >
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((cell) => {
              const selected = value === cell.iso;
              const isToday = today === cell.iso;
              return (
                <button
                  key={cell.iso}
                  type="button"
                  onClick={() => {
                    onChange(cell.iso);
                    setOpen(false);
                  }}
                  className={`h-8 rounded-lg text-xs font-mono tabular-nums transition-colors ${
                    selected
                      ? 'bg-accent text-white font-semibold shadow-sm shadow-accent/30'
                      : isToday
                        ? 'border border-accent/40 text-text-p bg-accent/10'
                        : cell.inMonth
                          ? 'text-text-p hover:bg-white/8'
                          : 'text-text-s/35 hover:bg-white/5'
                  }`}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-border/40">
            <button
              type="button"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
              className="text-[10px] font-bold uppercase tracking-widest text-text-s hover:text-text-p transition-colors px-1"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(today);
                setOpen(false);
              }}
              className="text-[10px] font-bold uppercase tracking-widest text-accent hover:text-accent/80 transition-colors px-1"
            >
              Today
            </button>
          </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  return (
    <div className={className}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => {
            const next = !v;
            if (next) {
              const trigger = triggerRef.current;
              if (trigger) setLayout(computePopoverLayout(trigger, 320));
            }
            return next;
          });
        }}
        className={`w-full bg-bg/50 border border-border rounded-xl px-5 py-4 text-sm font-mono text-left focus:outline-none focus:border-accent/50 transition-colors flex items-center gap-3 ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-border/80'
        }`}
      >
        <Calendar className="w-4 h-4 shrink-0 text-text-s/50" />
        <span className={value.trim() ? 'text-text-p tabular-nums' : 'text-text-s/50'}>{display}</span>
      </button>

      {typeof document !== 'undefined' ? createPortal(calendarPanel, document.body) : null}
    </div>
  );
}
