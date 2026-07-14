import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Asset } from './types';
import {
  ASSET_LOGO_OVERRIDES_CHANGED_EVENT,
  loadAssetLogoOverrides,
  resolveAssetLogoSources,
  urlForLogoSource,
  type AssetLogoSource,
} from './assetLogo';

export function IssuerLogo({
  ticker,
  name,
  type,
  logoUrl,
  yahooSymbol,
  size,
}: {
  ticker: string;
  name: string;
  type?: Asset['type'];
  logoUrl?: string | null;
  yahooSymbol?: string | null;
  size: number;
}) {
  const [overrides, setOverrides] = useState(loadAssetLogoOverrides);
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    const refresh = () => setOverrides(loadAssetLogoOverrides());
    window.addEventListener(ASSET_LOGO_OVERRIDES_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(ASSET_LOGO_OVERRIDES_CHANGED_EVENT, refresh);
  }, []);

  const resolved = useMemo(
    () =>
      resolveAssetLogoSources({
        ticker,
        name,
        type,
        logoUrl,
        yahooSymbol,
        overrides,
      }),
    [ticker, name, type, logoUrl, yahooSymbol, overrides]
  );

  const { chain, initials } = resolved;
  const currentSource: AssetLogoSource | null = chain[stageIndex] ?? null;
  const cryptoIndex = chain.slice(0, stageIndex).filter((s) => s === 'crypto').length;
  const src =
    currentSource != null
      ? urlForLogoSource(currentSource, resolved, cryptoIndex)
      : null;

  const advance = useCallback(() => {
    setStageIndex((i) => (i + 1 < chain.length ? i + 1 : chain.length));
  }, [chain.length]);

  useEffect(() => {
    setStageIndex(0);
  }, [ticker, name, type, logoUrl, yahooSymbol, overrides]);

  const px = `${size}px`;
  const textSize = size <= 20 ? 'text-[8px]' : 'text-[9px]';

  if (!src || stageIndex >= chain.length) {
    return (
      <span
        className={`shrink-0 inline-flex items-center justify-center rounded-full bg-white/10 border border-border/80 text-text-s font-bold uppercase leading-none ${textSize}`}
        style={{ width: px, height: px }}
        aria-hidden
      >
        {initials}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      width={size}
      height={size}
      className="shrink-0 rounded-full object-contain bg-white/5 border border-border/60"
      style={{ width: px, height: px }}
      onError={advance}
    />
  );
}

export function AssetNameCell({
  name,
  ticker,
  type,
  logoUrl,
  yahooSymbol,
  subline,
  variant = 'default',
}: {
  name: string;
  ticker: string;
  type?: Asset['type'];
  logoUrl?: string | null;
  /** Yahoo / listing symbol (e.g. BITCOIN-XBT.ST) for logo heuristics when display ticker is BTC. */
  yahooSymbol?: string | null;
  subline?: string;
  variant?: 'default' | 'dense';
}) {
  const line = (subline ?? ticker).trim();
  const logoSize = variant === 'dense' ? 20 : 24;
  const gap = variant === 'dense' ? 'gap-2' : 'gap-2.5';

  const logo = (
    <IssuerLogo
      ticker={ticker}
      name={name}
      type={type}
      logoUrl={logoUrl}
      yahooSymbol={yahooSymbol}
      size={logoSize}
    />
  );

  if (variant === 'dense') {
    return (
      <div className={`flex items-center ${gap} min-w-0`}>
        {logo}
        <div className="min-w-0">
          <div className="text-text-p text-[11px] font-sans font-semibold truncate leading-snug" title={name}>
            {name}
          </div>
          {line ? (
            <div className="mt-0.5 text-[10px] text-text-s/70 font-sans truncate leading-snug">
              {line}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center ${gap} min-w-0`}>
      {logo}
      <div className="min-w-0">
        <div className="text-text-p text-sm font-sans truncate" title={name}>
          {name}
        </div>
        {line ? (
          <div className="mt-0.5 text-[9px] text-text-s/60 font-mono uppercase tracking-widest truncate">
            {line}
          </div>
        ) : null}
      </div>
    </div>
  );
}
