import type { SVGProps } from 'react';

/** Portfolio trend line — matches public/favicon.svg */
export function BorsMark({ className, ...props }: SVGProps<SVGSVGElement>) {
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
        d="M8 21.5 12.5 17 17 18.5 24 10.5"
        stroke="#3b82f6"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="24" cy="10.5" r="1.75" fill="#3b82f6" />
    </svg>
  );
}
