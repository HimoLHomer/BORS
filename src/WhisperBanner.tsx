import React, { useEffect } from 'react';
import { Sparkles, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { playMilestoneChime } from './uiFeedback';

export function WhisperBanner({
  visible,
  message,
  onDismiss,
}: {
  visible: boolean;
  message: string;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (visible) playMilestoneChime();
  }, [visible]);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="whisper-banner"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="pointer-events-none fixed left-0 right-0 top-[65px] z-50 px-4"
          role="status"
          aria-live="polite"
        >
          <div className="pointer-events-auto relative mx-auto flex max-w-[1400px] items-center gap-3 overflow-hidden rounded-xl border border-green/35 bg-gradient-to-r from-green/[0.14] via-card/95 to-card/95 py-3 pl-3.5 pr-3 shadow-[0_4px_28px_rgba(34,197,94,0.2)] backdrop-blur-md">
            <div
              className="absolute inset-y-0 left-0 w-1 rounded-l-xl bg-green/60"
              aria-hidden
            />
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green/15 ring-1 ring-green/25"
              aria-hidden
            >
              <Sparkles className="h-4 w-4 text-green" />
            </div>
            <div className="min-w-0 flex-1 py-0.5">
              <p className="micro-label mb-0.5 text-green">Milestone</p>
              <p className="mb-0 text-sm font-semibold leading-snug text-text-p">{message}</p>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              className="shrink-0 rounded-lg p-1.5 text-green/70 transition-colors hover:bg-green/10 hover:text-green"
              aria-label="Dismiss milestone"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
