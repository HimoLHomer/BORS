import React from 'react';

const EUR_ICON_CLASS =
  'absolute left-3 top-1/2 -translate-y-1/2 text-text-s/55 text-xs font-mono font-bold pointer-events-none select-none';

const EUR_ICON_COMPACT =
  'absolute left-2 top-1/2 -translate-y-1/2 text-text-s/55 text-[10px] font-mono font-bold pointer-events-none select-none';

const EUR_INPUT_BASE =
  'w-full bg-bg/50 border border-border rounded-xl text-text-p font-mono focus:outline-none focus:border-accent/50 tabular-nums';

const EUR_INPUT_COMPACT_BASE =
  'w-full bg-bg/50 border border-border rounded-lg text-text-p font-mono focus:outline-none focus:border-accent/50 tabular-nums box-border leading-none';

/** Left padding so typed amounts clear the € prefix. */
export const EUR_AMOUNT_INPUT_PAD = 'pl-8';

/** Short symbol for a currency code ("$", "£", "kr"); the code itself when there is none. */
export function currencySymbol(currency: string | undefined): string {
  const code = (currency || 'EUR').toUpperCase();
  try {
    const part = new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0)
      .find((p) => p.type === 'currency');
    return part?.value || code;
  } catch {
    return code;
  }
}

/** Left padding that clears a prefix of this length. */
function padForSymbol(symbol: string, compact: boolean): string {
  if (symbol.length <= 1) return compact ? 'pl-7' : EUR_AMOUNT_INPUT_PAD;
  if (symbol.length === 2) return compact ? 'pl-9' : 'pl-10';
  return compact ? 'pl-11' : 'pl-12';
}

export function EurAmountField({
  className = '',
  iconClassName = EUR_ICON_CLASS,
  inputPadClassName = EUR_AMOUNT_INPUT_PAD,
  symbol = '€',
  children,
}: {
  className?: string;
  iconClassName?: string;
  inputPadClassName?: string;
  /** Prefix shown in the field; defaults to €. */
  symbol?: string;
  children: React.ReactElement<{ className?: string }>;
}) {
  return (
    <div className={`relative ${className}`}>
      <span className={iconClassName} aria-hidden>
        {symbol}
      </span>
      {React.cloneElement(children, {
        className: [children.props.className, inputPadClassName].filter(Boolean).join(' '),
      })}
    </div>
  );
}

export function EurAmountInput({
  className = '',
  wrapperClassName = '',
  compact = false,
  currency = 'EUR',
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  wrapperClassName?: string;
  compact?: boolean;
  /** Currency of the amount; sets the prefix (defaults to EUR). */
  currency?: string;
}) {
  const inputClass = compact
    ? `${EUR_INPUT_COMPACT_BASE} h-8 py-0 text-[11px] ${className}`
    : `${EUR_INPUT_BASE} py-3 ${className}`;
  const symbol = currencySymbol(currency);

  return (
    <EurAmountField
      className={wrapperClassName}
      iconClassName={compact ? EUR_ICON_COMPACT : EUR_ICON_CLASS}
      inputPadClassName={padForSymbol(symbol, compact)}
      symbol={symbol}
    >
      <input type="text" inputMode="decimal" className={inputClass} {...props} />
    </EurAmountField>
  );
}
