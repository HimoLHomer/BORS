import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useEscapeToClose } from './useEscapeToClose';

export type ConfirmOptions = {
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button, for removals. */
  destructive?: boolean;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

function ConfirmDialogView({ pending, onAnswer }: { pending: Pending; onAnswer: (ok: boolean) => void }) {
  useEscapeToClose(() => onAnswer(false));
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => confirmRef.current?.focus(), []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-bg/80 backdrop-blur-sm p-4"
      onClick={() => onAnswer(false)}
    >
      <motion.div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        initial={{ scale: 0.96, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 8 }}
        className="glass-panel w-full max-w-sm bg-card/90 border-border p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="text-base font-semibold tracking-tight text-text-p">
          {pending.title}
        </h2>
        {pending.body ? <div className="mt-2 text-xs leading-relaxed text-text-s">{pending.body}</div> : null}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onAnswer(false)}
            className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-text-s hover:bg-white/5 hover:text-text-p transition-colors"
          >
            {pending.cancelLabel ?? 'Cancel'}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => onAnswer(true)}
            className={`rounded-lg px-4 py-2 text-xs font-semibold text-white transition-colors ${
              pending.destructive ? 'bg-red hover:bg-red/90' : 'bg-accent hover:bg-accent/90'
            }`}
          >
            {pending.confirmLabel ?? 'OK'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * In-app replacement for `window.confirm`: `await confirm({...})` resolves true/false.
 * Render the returned `dialog` once near the root.
 */
export function useConfirmDialog(): {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  dialog: React.ReactNode;
} {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending((prev) => {
          prev?.resolve(false);
          return { ...opts, resolve };
        });
      }),
    []
  );

  const answer = useCallback((ok: boolean) => {
    setPending((prev) => {
      prev?.resolve(ok);
      return null;
    });
  }, []);

  const dialog = (
    <AnimatePresence>
      {pending ? <ConfirmDialogView key="confirm-dialog" pending={pending} onAnswer={answer} /> : null}
    </AnimatePresence>
  );

  return { confirm, dialog };
}

/** Bottom toast with an Undo action; disappears after `durationMs`. */
export function UndoToast({
  message,
  onUndo,
  onDismiss,
  durationMs = 10_000,
}: {
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
  durationMs?: number;
}) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  useEffect(() => {
    const id = window.setTimeout(() => onDismissRef.current(), durationMs);
    return () => window.clearTimeout(id);
  }, [message, durationMs]);

  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      className="fixed bottom-6 left-1/2 z-[65] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 text-xs text-text-p shadow-2xl"
    >
      <span className="min-w-0">{message}</span>
      <button
        type="button"
        onClick={onUndo}
        className="shrink-0 rounded-md px-2 py-1 font-semibold text-accent hover:bg-accent/10 transition-colors"
      >
        Undo
      </button>
    </motion.div>
  );
}
