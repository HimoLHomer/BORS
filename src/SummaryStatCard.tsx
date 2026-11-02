import React from 'react';
import { InfoHint } from './InfoHint';

type SummaryStatCardProps = {
  title: string;
  hero: React.ReactNode;
  footer?: React.ReactNode;
  emptyFooter?: React.ReactNode;
  /** Optional explanation shown from an "i" icon next to the title. */
  info?: React.ReactNode;
};

export function SummaryStatCard({
  title,
  hero,
  footer,
  emptyFooter,
  info,
}: SummaryStatCardProps) {
  const subline = footer ?? emptyFooter;

  return (
    <div className="panel flex flex-col h-full">
      {/* .card-title's margin is unlayered CSS and beats mb-0; keep it off the flex row. */}
      <div className="flex items-center gap-1.5 mb-2">
        <h3 className="card-title !mb-0">{title}</h3>
        {info ? <InfoHint label={`About ${title}`}>{info}</InfoHint> : null}
      </div>
      <div className="stat-value text-6xl font-black tracking-tighter tabular-nums mt-2 leading-none">
        {hero}
      </div>
      {subline}
      <div className="flex-1 min-h-0" aria-hidden />
    </div>
  );
}
