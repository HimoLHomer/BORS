import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { formatDecimalFi, formatWholeNumber, parseDecimalInput } from './formatNumber';

type Options = {
  fractionDigits?: number;
  readOnly?: boolean;
  min?: number;
  /** When false, integers render without spaced thousands (e.g. 2026 not 2 026). */
  groupThousands?: boolean;
  /** Shown tight after the number, e.g. `7,00 %`. Parsed away on commit. */
  trailingSuffix?: '%';
};

function formatDraftValue(
  value: number,
  fractionDigits: number,
  groupThousands: boolean,
  trailingSuffix?: '%'
): string {
  if (!Number.isFinite(value)) return '';
  const num =
    !groupThousands && fractionDigits === 0
      ? formatWholeNumber(value)
      : formatDecimalFi(value, fractionDigits);
  if (!num) return '';
  return trailingSuffix === '%' ? `${num}\u00a0%` : num;
}

function parseDraftValue(raw: string, fallback: number): number {
  return parseDecimalInput(raw.replace(/%/g, ''), fallback);
}

/** Controlled text input that displays Finnish decimals (comma, spaced thousands). */
export function useFiDecimalDraft(
  value: number,
  onChange: ((n: number) => void) | undefined,
  options: Options = {}
) {
  const {
    fractionDigits = 2,
    readOnly = false,
    min,
    groupThousands = true,
    trailingSuffix,
  } = options;

  const format = useCallback(
    (n: number) => formatDraftValue(n, fractionDigits, groupThousands, trailingSuffix),
    [fractionDigits, groupThousands, trailingSuffix]
  );

  const [draft, setDraft] = useState(() => format(value));
  const editingRef = useRef(false);

  useLayoutEffect(() => {
    if (!editingRef.current || readOnly) {
      setDraft(format(value));
    }
  }, [value, format, readOnly]);

  const commit = useCallback(() => {
    if (readOnly || !onChange) return;
    editingRef.current = false;
    let n = parseDraftValue(draft, value);
    if (min != null) n = Math.max(min, n);
    const rounded =
      fractionDigits === 0
        ? Math.round(n)
        : Math.round(n * 10 ** fractionDigits) / 10 ** fractionDigits;
    onChange(rounded);
    setDraft(format(rounded));
  }, [draft, format, fractionDigits, min, onChange, readOnly, value]);

  const inputProps = {
    value: draft,
    onFocus: () => {
      if (!readOnly) editingRef.current = true;
    },
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      if (readOnly || !onChange) return;
      setDraft(e.target.value);
    },
    onBlur: commit,
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') e.currentTarget.blur();
    },
  };

  return { draft, setDraft, inputProps, commit };
}
