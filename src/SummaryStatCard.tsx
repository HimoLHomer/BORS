import React from 'react';

type SummaryStatCardProps = {
  title: string;
  hero: React.ReactNode;
  footer?: React.ReactNode;
  emptyFooter?: React.ReactNode;
};

export function SummaryStatCard({
  title,
  hero,
  footer,
  emptyFooter,
}: SummaryStatCardProps) {
  const subline = footer ?? emptyFooter;

  return (
    <div className="panel flex flex-col h-full">
      <h3 className="card-title mb-0">{title}</h3>
      <div className="stat-value text-6xl font-black tracking-tighter tabular-nums mt-2 leading-none">
        {hero}
      </div>
      {subline}
      <div className="flex-1 min-h-0" aria-hidden />
    </div>
  );
}
