import React from 'react';

const EUR_ICON_CLASS =
  'absolute left-3 top-1/2 -translate-y-1/2 text-text-s/55 text-xs font-mono font-bold pointer-events-none select-none';

const EUR_INPUT_BASE =
  'w-full bg-bg/50 border border-border rounded-xl text-text-p font-mono focus:outline-none focus:border-accent/50 tabular-nums';

/** Left padding so typed amounts clear the € prefix. */
export const EUR_AMOUNT_INPUT_PAD = 'pl-8';

export function EurAmountField({
  className = '',
  children,
}: {
  className?: string;
  children: React.ReactElement<{ className?: string }>;
}) {
  return (
    <div className={`relative ${className}`}>
      <span className={EUR_ICON_CLASS} aria-hidden>
        €
      </span>
      {React.cloneElement(children, {
        className: [children.props.className, EUR_AMOUNT_INPUT_PAD].filter(Boolean).join(' '),
      })}
    </div>
  );
}

export function EurAmountInput({
  className = '',
  wrapperClassName = '',
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { wrapperClassName?: string }) {
  return (
    <EurAmountField className={wrapperClassName}>
      <input
        type="text"
        inputMode="decimal"
        className={`${EUR_INPUT_BASE} py-3 ${className}`}
        {...props}
      />
    </EurAmountField>
  );
}
