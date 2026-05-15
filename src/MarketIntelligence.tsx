import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import { Treemap, ResponsiveContainer } from 'recharts';
import { formatPercentFi } from './formatNumber';
import { formatCurrency } from './formatCurrency';
import { fetchJson } from './apiFetch';
import {
  AlternativeInvestmentsPanel,
  MarketIndexPanel,
  useMarketOverview,
} from './MarketOverviewPanels';
import { MARKET_PANEL } from './marketTheme';

type HeatmapUniverse = 'sp500' | 'omxh25';

/** Largest S&P names only — keeps tiles readable (full index still cached on server). */
const SP500_DISPLAY_CAP = 32;

/** Max stocks per sector + min cap share — avoids unreadable slivers. */
const MAX_TILES_PER_SECTOR = 6;
const MIN_TILE_SHARE_OF_SECTOR = 0.035;
const OMX_DISPLAY_CAP = 14;

/** Squarify target — nearer 1 = more square tiles, fewer thin bars. */
const TILE_ASPECT_RATIO = 1;
const MIN_SECTOR_BAND_WIDTH = 72;

const SECTOR_HEADER_H = 22;

/** Shared treemap label caps — same for S&P 500 and OMX Helsinki 25. */
const TREEMAP_FONT_CAP_MAIN = 12;
const TREEMAP_FONT_CAP_SUB = 9;
const TREEMAP_FONT_CAP_TINY = 7;
const TREEMAP_FONT_CAP_MICRO = 6;

/** Vibrant green/red fills — alpha scales with |change| (matches --color-green / --color-red). */
function heatmapTileFill(change: number): string {
  const t = Math.min(Math.abs(change) / 4, 1);
  const alpha = 0.28 + t * 0.44;
  return change >= 0
    ? `rgba(34, 197, 94, ${alpha})`
    : `rgba(239, 68, 68, ${alpha})`;
}

function HeatmapTileGlowDefs({ greenId, redId }: { greenId: string; redId: string }) {
  return (
    <defs>
      <filter id={greenId} x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
        <feColorMatrix
          in="blur"
          type="matrix"
          values="0 0 0 0 0.13  0 0 0 0 0.77  0 0 0 0 0.37  0 0 0 0.42 0"
          result="glow"
        />
        <feMerge>
          <feMergeNode in="glow" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id={redId} x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
        <feColorMatrix
          in="blur"
          type="matrix"
          values="0 0 0 0 0.94  0 0 0 0 0.27  0 0 0 0 0.27  0 0 0 0.42 0"
          result="glow"
        />
        <feMerge>
          <feMergeNode in="glow" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}

function treemapFontSizes(
  boxW: number,
  boxH: number,
  area: number
): { main: number; sub: number; tiny: number; micro: number } {
  const minDim = Math.min(boxW, boxH);
  if (area < 120) return { main: 6, sub: 6, tiny: 5, micro: 5 };
  if (area < 280) {
    return {
      main: Math.min(7, minDim * 0.36),
      sub: 6,
      tiny: 5,
      micro: 5,
    };
  }
  if (area < 600) {
    return {
      main: Math.min(9, minDim / 3.4),
      sub: Math.min(7, minDim / 4.2),
      tiny: 6,
      micro: 5,
    };
  }
  return {
    main: Math.min(TREEMAP_FONT_CAP_MAIN, minDim / 3.1),
    sub: Math.min(TREEMAP_FONT_CAP_SUB, minDim / 3.8),
    tiny: TREEMAP_FONT_CAP_TINY,
    micro: TREEMAP_FONT_CAP_MICRO,
  };
}

type HeatmapTile = {
  symbol: string;
  name: string;
  size: number;
  change: number;
  price: number | null;
  currency: string;
};

type HeatmapSector = {
  name: string;
  children: HeatmapTile[];
};

type HeatmapApiResponse = {
  universe: string;
  asOf: string;
  cached: boolean;
  sectors: HeatmapSector[];
};

type TreemapNode = {
  name: string;
  size?: number;
  change?: number;
  symbol?: string;
  fullName?: string;
  price?: number | null;
  currency?: string;
  sectorName?: string;
  children?: TreemapNode[];
};

function trimSectorChildren(children: HeatmapTile[]): HeatmapTile[] {
  const sorted = [...children].sort((a, b) => b.size - a.size);
  const total = sorted.reduce((s, t) => s + t.size, 0);
  if (total <= 0) return sorted.slice(0, MAX_TILES_PER_SECTOR);
  const minSize = total * MIN_TILE_SHARE_OF_SECTOR;
  return sorted.filter((t) => t.size >= minSize).slice(0, MAX_TILES_PER_SECTOR);
}

function prepareSectorsForTreemap(sectors: HeatmapSector[]): HeatmapSector[] {
  return sectors
    .map((s) => ({ name: s.name, children: trimSectorChildren(s.children) }))
    .filter((s) => s.children.length > 0);
}

/** GICS sector → short header labels (Finviz-style). */
const SECTOR_DISPLAY: Record<string, string> = {
  'Information Technology': 'TECHNOLOGY',
  Financials: 'FINANCIAL',
  'Health Care': 'HEALTHCARE',
  'Consumer Discretionary': 'CONSUMER CYCLICAL',
  'Consumer Staples': 'CONSUMER DEFENSIVE',
  'Communication Services': 'COMMUNICATION SERVICES',
  Industrials: 'INDUSTRIALS',
  Energy: 'ENERGY',
  Utilities: 'UTILITIES',
  'Real Estate': 'REAL ESTATE',
  Materials: 'BASIC MATERIALS',
};

function sectorHeaderLabel(name: string): string {
  return SECTOR_DISPLAY[name] ?? name.toUpperCase();
}

type HeatmapHover = {
  x: number;
  y: number;
  symbol: string;
  fullName: string;
  price: number | null;
  currency: string;
  change: number;
};

function shortenTicker(symbol: string): string {
  return symbol.replace(/\.HE$/i, '');
}

/** One tile per issuer — avoids GOOGL+GOOG, BRK-B+BRK.B, etc. */
const SHARE_CLASS_GROUP: Record<string, string> = {
  GOOG: 'ALPHABET',
  GOOGL: 'ALPHABET',
  'BRK.B': 'BRK',
  'BRK-B': 'BRK',
  FOX: 'FOX',
  FOXA: 'FOX',
  NWS: 'NWS',
  NWSA: 'NWS',
  'BF.B': 'BF',
  'BF-B': 'BF',
};

function shareClassGroupKey(symbol: string): string {
  return SHARE_CLASS_GROUP[symbol] ?? symbol;
}

function dedupeShareClasses(
  tagged: { tile: HeatmapTile; sector: string }[]
): { tile: HeatmapTile; sector: string }[] {
  const best = new Map<string, { tile: HeatmapTile; sector: string }>();
  for (const entry of tagged) {
    const key = shareClassGroupKey(entry.tile.symbol);
    const prev = best.get(key);
    if (!prev || entry.tile.size > prev.tile.size) best.set(key, entry);
  }
  return [...best.values()];
}

function limitSectorsForDisplay(sectors: HeatmapSector[], maxTiles: number): HeatmapSector[] {
  const tagged = sectors.flatMap((s) => s.children.map((tile) => ({ tile, sector: s.name })));
  const deduped = dedupeShareClasses(tagged);
  const top = [...deduped].sort((a, b) => b.tile.size - a.tile.size).slice(0, maxTiles);
  const bySector = new Map<string, HeatmapTile[]>();
  for (const { tile, sector } of top) {
    const list = bySector.get(sector) ?? [];
    list.push(tile);
    bySector.set(sector, list);
  }
  return prepareSectorsForTreemap(
    [...bySector.entries()]
      .map(([name, children]) => ({
        name,
        children: children.sort((a, b) => b.size - a.size),
      }))
      .sort((a, b) => {
        const sa = a.children.reduce((s, t) => s + t.size, 0);
        const sb = b.children.reduce((s, t) => s + t.size, 0);
        return sb - sa;
      })
  );
}

function mapTileToNode(c: HeatmapTile, universe: HeatmapUniverse, sectorName: string): TreemapNode {
  return {
    name: universe === 'omxh25' ? shortenTicker(c.symbol) : c.symbol,
    symbol: c.symbol,
    fullName: c.name,
    sectorName,
    size: c.size,
    change: c.change,
    price: c.price,
    currency: c.currency,
  };
}

function sectorsToTreemapData(sectors: HeatmapSector[], universe: HeatmapUniverse): TreemapNode[] {
  const prepared = prepareSectorsForTreemap(sectors);

  if (universe === 'omxh25') {
    const tiles = prepared
      .flatMap((s) => s.children)
      .sort((a, b) => b.size - a.size)
      .slice(0, OMX_DISPLAY_CAP);
    return [
      {
        name: 'OMX Helsinki 25',
        children: tiles.map((c) => mapTileToNode(c, universe, 'OMX Helsinki 25')),
      },
    ];
  }

  return prepared.map((s) => ({
    name: s.name,
    children: s.children.map((c) => mapTileToNode(c, universe, s.name)),
  }));
}

function fitTreemapText(text: string, maxWidth: number, fontSize: number): string {
  const charW = fontSize * 0.55;
  const max = Math.max(2, Math.floor(maxWidth / charW));
  if (text.length <= max) return text;
  return max > 2 ? `${text.slice(0, max - 1)}…` : text.slice(0, max);
}

function pctFitsInBox(
  pctText: string,
  width: number,
  fontSize: number,
  height?: number
): boolean {
  const hPad = 10;
  if (pctText.length * fontSize * 0.5 > width - hPad) return false;
  if (height != null && height < fontSize * 1.3 + 4) return false;
  return true;
}

function stackedLabelFits(
  ticker: string,
  pctText: string,
  width: number,
  height: number,
  tickerFs: number,
  pctFs: number,
  gap: number
): boolean {
  const lineH = (fs: number) => fs * 1.28;
  const needed = lineH(tickerFs) + lineH(pctFs) + gap + 6;
  if (height < needed) return false;
  return (
    fitTreemapText(ticker, width, tickerFs) === ticker &&
    pctFitsInBox(pctText, width, pctFs, height - lineH(tickerFs) - gap)
  );
}

function buildTileLookup(
  sectors: HeatmapSector[],
  universe: HeatmapUniverse
): Map<string, HeatmapTile> {
  const m = new Map<string, HeatmapTile>();
  for (const s of sectors) {
    for (const t of s.children) {
      m.set(t.symbol, t);
      m.set(universe === 'omxh25' ? shortenTicker(t.symbol) : t.symbol, t);
    }
  }
  return m;
}

function resolveTile(
  lookup: Map<string, HeatmapTile> | undefined,
  displayName?: string,
  symbol?: string
): HeatmapTile | undefined {
  if (!lookup) return undefined;
  if (symbol) {
    const hit = lookup.get(symbol);
    if (hit) return hit;
  }
  if (displayName) return lookup.get(displayName);
  return undefined;
}

function treemapClipId(x: number, y: number): string {
  return `hc-${Math.round(x * 10)}-${Math.round(y * 10)}`;
}

function TreemapLabel({
  x,
  y,
  fontSize,
  fontWeight = 600,
  anchor = 'middle',
  baseline = 'auto',
  contrastStroke = false,
  children,
}: {
  x: number;
  y: number;
  fontSize: number;
  fontWeight?: number;
  anchor?: 'middle' | 'start';
  baseline?: 'auto' | 'middle';
  contrastStroke?: boolean;
  children: string;
}) {
  const px = Math.round(x);
  const py = Math.round(y);
  const useStroke = contrastStroke && fontSize <= 9;
  return (
    <text
      x={px}
      y={py}
      textAnchor={anchor}
      dominantBaseline={baseline === 'middle' ? 'middle' : undefined}
      fill="#f4f4f5"
      fontSize={fontSize}
      fontWeight={fontWeight}
      stroke={useStroke ? 'rgba(9,9,11,0.55)' : 'none'}
      strokeWidth={useStroke ? 0.6 : 0}
      paintOrder={useStroke ? 'stroke fill' : undefined}
      style={{
        pointerEvents: 'none',
        fontFamily: 'var(--font-sans)',
        textRendering: 'geometricPrecision',
      }}
    >
      {children}
    </text>
  );
}

type TreemapContentProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  depth?: number;
  change?: number;
  symbol?: string;
  fullName?: string;
  price?: number | null;
  currency?: string;
  children?: readonly unknown[] | null;
  showSectorHeaders?: boolean;
  tileLookup?: Map<string, HeatmapTile>;
  sectorName?: string;
  sectorLayoutRef?: React.MutableRefObject<Map<string, number>>;
  glowGreenId?: string;
  glowRedId?: string;
  onHover?: (info: HeatmapHover, clientX: number, clientY: number) => void;
  onLeave?: () => void;
};

const CustomTreemapContent = (props: TreemapContentProps) => {
  const {
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    name,
    depth = 0,
    children,
    showSectorHeaders = true,
    onHover,
    onLeave,
    tileLookup,
    sectorName,
    sectorLayoutRef,
    glowGreenId,
    glowRedId,
  } = props;

  if (depth === 0) {
    sectorLayoutRef?.current.clear();
    if (glowGreenId && glowRedId) {
      return <HeatmapTileGlowDefs greenId={glowGreenId} redId={glowRedId} />;
    }
  }

  let boxX = x;
  let boxY = y;
  let boxW = width;
  let boxH = height;

  const sectorTop =
    sectorName != null ? sectorLayoutRef?.current.get(sectorName) : undefined;
  if (sectorTop != null && boxH > 8) {
    const topInSector = boxY - sectorTop;
    if (topInSector < SECTOR_HEADER_H) {
      const shift = SECTOR_HEADER_H - topInSector;
      if (boxH > shift + 6) {
        boxY += shift;
        boxH -= shift;
      }
    }
  }

  const isGroup = Boolean(children && children.length > 0);
  if (showSectorHeaders && isGroup && depth === 1 && width >= MIN_SECTOR_BAND_WIDTH) {
    sectorLayoutRef?.current.set(name ?? '', y);
    const headerH = SECTOR_HEADER_H;
    const label = sectorHeaderLabel(name ?? '');
    const fontSize = width > 140 ? 11 : 9;
    return (
      <g pointerEvents="none">
        <rect
          x={x}
          y={y}
          width={width}
          height={headerH}
          fill="#18181b"
          stroke="rgba(39,39,42,0.95)"
          strokeWidth={1}
        />
        <text
          x={Math.round(x + 8)}
          y={Math.round(y + headerH / 2)}
          fill="#d4d4d8"
          fontSize={fontSize}
          fontWeight={600}
          dominantBaseline="middle"
          style={{
            letterSpacing: '0.1em',
            fontFamily: 'var(--font-sans)',
            textRendering: 'geometricPrecision',
          }}
        >
          {fitTreemapText(label, width - 16, fontSize)}
        </text>
      </g>
    );
  }

  if (isGroup || depth < 1 || boxW < 5 || boxH < 5) return null;

  const change = typeof props.change === 'number' ? props.change : 0;
  const color = heatmapTileFill(change);
  const tileGlowFilter =
    glowGreenId && glowRedId
      ? `url(#${change >= 0 ? glowGreenId : glowRedId})`
      : undefined;

  const inset = 4;
  const innerW = Math.max(0, boxW - inset * 2);
  const innerH = Math.max(0, boxH - inset * 2);
  const area = innerW * innerH;
  const minDim = Math.min(innerW, innerH);
  const aspect = innerW / Math.max(innerH, 1);
  const isSliver = aspect > 3.2 || aspect < 0.3 || minDim < 14 || area < 160;
  const pctDecimals = innerW < 32 || minDim < 22 ? 0 : minDim < 30 ? 1 : 2;
  const pctText = formatPercentFi(change, pctDecimals, { showPlus: true });
  const pctCompact = formatPercentFi(change, 0, { showPlus: true });
  const ticker = name ?? '';
  const tile = resolveTile(tileLookup, ticker, props.symbol);

  const { main: fontMain, sub: fontSub, tiny: fontTiny, micro: fontMicro } = treemapFontSizes(
    innerW,
    innerH,
    area
  );

  const pctOkSub = pctFitsInBox(pctText, innerW, fontSub, innerH);
  const pctOkTiny = pctFitsInBox(pctText, innerW, fontTiny, innerH);
  const pctOkMicro = pctFitsInBox(pctCompact, innerW, fontMicro, innerH);
  const labelGap = 4;

  const showBoth =
    !isSliver &&
    innerW >= 54 &&
    innerH >= 40 &&
    area >= 480 &&
    pctOkSub &&
    stackedLabelFits(ticker, pctText, innerW, innerH, fontMain, fontSub, 8);
  const showStacked =
    !isSliver &&
    !showBoth &&
    innerW >= 38 &&
    innerH >= 30 &&
    area >= 280 &&
    stackedLabelFits(ticker, pctText, innerW, innerH, fontSub, fontTiny, labelGap);
  const showTickerWithPct =
    !showBoth &&
    !showStacked &&
    innerW >= 24 &&
    innerH >= 26 &&
    area >= 220 &&
    aspect >= 0.45 &&
    stackedLabelFits(ticker, pctCompact, innerW, innerH, fontSub, fontMicro, 3);
  const showTickerOnly =
    !showBoth &&
    !showStacked &&
    !showTickerWithPct &&
    innerW >= 18 &&
    innerH >= 14 &&
    aspect >= 0.4;
  const showPctOnly =
    !showBoth &&
    !showStacked &&
    !showTickerWithPct &&
    !showTickerOnly &&
    innerW >= 14 &&
    innerH >= 12 &&
    (pctOkMicro || pctOkTiny);

  const hoverPayload: HeatmapHover = {
    x: 0,
    y: 0,
    symbol: tile?.symbol ?? props.symbol ?? ticker,
    fullName: tile?.name ?? props.fullName ?? ticker,
    price: tile?.price ?? props.price ?? null,
    currency: tile?.currency ?? props.currency ?? 'USD',
    change: tile?.change ?? change,
  };

  const clipId = treemapClipId(boxX, boxY);
  const cx = boxX + boxW / 2;
  const labelTop = boxY + inset;
  const labelMid = boxY + boxH / 2;

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <rect
            x={boxX + inset}
            y={boxY + inset}
            width={innerW}
            height={innerH}
          />
        </clipPath>
      </defs>
      <rect
        x={boxX}
        y={boxY}
        width={boxW}
        height={boxH}
        filter={tileGlowFilter}
        style={{
          fill: color,
          stroke: 'rgba(39,39,42,0.8)',
          strokeWidth: 1,
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => onHover?.(hoverPayload, e.clientX, e.clientY)}
        onMouseMove={(e) => onHover?.(hoverPayload, e.clientX, e.clientY)}
        onMouseLeave={() => onLeave?.()}
      />
      <g clipPath={`url(#${clipId})`}>
        {showBoth && (
          <>
            <TreemapLabel
              x={cx}
              y={labelMid - 7}
              fontSize={fontMain}
              contrastStroke
            >
              {fitTreemapText(ticker, innerW, fontMain)}
            </TreemapLabel>
            <TreemapLabel
              x={cx}
              y={labelMid + fontSub * 1.15}
              fontSize={fontSub}
              contrastStroke
            >
              {pctText}
            </TreemapLabel>
          </>
        )}
        {showStacked && (
          <>
            <TreemapLabel
              x={cx}
              y={labelTop + fontSub * 0.85}
              fontSize={fontSub}
              contrastStroke
            >
              {fitTreemapText(ticker, innerW, fontSub)}
            </TreemapLabel>
            <TreemapLabel
              x={cx}
              y={labelTop + fontSub * 2.1 + labelGap}
              fontSize={fontTiny}
              contrastStroke
            >
              {pctText}
            </TreemapLabel>
          </>
        )}
        {showTickerWithPct && (
          <>
            <TreemapLabel
              x={cx}
              y={labelTop + fontSub * 0.85}
              fontSize={fontSub}
              contrastStroke
            >
              {fitTreemapText(ticker, innerW, fontSub)}
            </TreemapLabel>
            <TreemapLabel
              x={cx}
              y={labelTop + fontSub * 2.05 + 3}
              fontSize={fontMicro}
              contrastStroke
            >
              {pctCompact}
            </TreemapLabel>
          </>
        )}
        {showTickerOnly && (
          <TreemapLabel
            x={cx}
            y={labelMid + 1}
            fontSize={area < 200 ? fontTiny : fontSub}
            contrastStroke
          >
            {fitTreemapText(ticker, innerW, area < 200 ? fontTiny : fontSub)}
          </TreemapLabel>
        )}
        {showPctOnly && (
          <TreemapLabel
            x={cx}
            y={labelMid + 1}
            fontSize={fontTiny}
            contrastStroke
          >
            {pctOkTiny ? pctText : pctCompact}
          </TreemapLabel>
        )}
      </g>
    </g>
  );
};

function useHeatmap(universe: HeatmapUniverse, maxTiles?: number) {
  const [sectors, setSectors] = useState<HeatmapSector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ asOf: string; cached: boolean } | null>(null);

  const data = useMemo(
    () => sectorsToTreemapData(sectors, universe),
    [sectors, universe]
  );

  const tileCount = useMemo(
    () => sectors.reduce((n, s) => n + s.children.length, 0),
    [sectors]
  );

  const tileLookup = useMemo(
    () => buildTileLookup(sectors, universe),
    [sectors, universe]
  );

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/market/heatmap?universe=${universe}${refresh ? '&refresh=1' : ''}`,
        { cache: 'no-store' }
      );
      const json = await fetchJson<HeatmapApiResponse & { error?: string }>(res);
      if (!res.ok) {
        throw new Error(json.error ?? `Heatmap request failed (${res.status})`);
      }
      if (!Array.isArray(json.sectors) || json.sectors.length === 0) {
        throw new Error('No heatmap data returned');
      }
      const raw = json.sectors;
      setSectors(maxTiles ? limitSectorsForDisplay(raw, maxTiles) : raw);
      setMeta({ asOf: json.asOf, cached: json.cached });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Heatmap request failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [universe, maxTiles]);

  useEffect(() => {
    void load(false);
  }, [load]);

  return { data, loading, error, meta, tileCount, tileLookup, reload: () => load(true) };
}

function TreemapChart({
  data,
  tileLookup,
  showSectorHeaders = true,
}: {
  data: TreemapNode[];
  tileLookup: Map<string, HeatmapTile>;
  showSectorHeaders?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sectorLayoutRef = useRef<Map<string, number>>(new Map());
  const [hover, setHover] = useState<HeatmapHover | null>(null);
  const reactId = React.useId();
  const glowGreenId = `hg-g-${reactId.replace(/:/g, '')}`;
  const glowRedId = `hg-r-${reactId.replace(/:/g, '')}`;

  const handleHover = useCallback((info: HeatmapHover, clientX: number, clientY: number) => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return;
    const pad = 12;
    let x = clientX - box.left + pad;
    let y = clientY - box.top + pad;
    x = Math.min(x, box.width - 200);
    y = Math.min(y, box.height - 88);
    setHover({ ...info, x: Math.max(8, x), y: Math.max(8, y) });
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-visible"
      onMouseLeave={() => setHover(null)}
    >
      {hover && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-20 max-w-[220px] rounded-lg border border-white/15 bg-[#0c0c0e]/95 px-3 py-2 shadow-xl backdrop-blur-sm"
          style={{ left: hover.x, top: hover.y }}
        >
          <p className="text-xs font-black text-white uppercase tracking-tight">{hover.symbol}</p>
          <p className="text-[11px] text-text-s leading-snug mt-0.5 line-clamp-2">{hover.fullName}</p>
          <p className="text-sm font-semibold text-text-p mt-1.5 tabular-nums">
            {hover.price != null ? (
              <>
                {formatCurrency(hover.price, hover.currency)}
                <span className="text-text-s font-normal text-xs ml-1.5">
                  {formatPercentFi(hover.change, 2, { showPlus: true })}
                </span>
              </>
            ) : (
              <span>{formatPercentFi(hover.change, 2, { showPlus: true })} today</span>
            )}
          </p>
        </div>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <Treemap
          data={data}
          dataKey="size"
          stroke="rgba(0,0,0,0.5)"
          fill="transparent"
          aspectRatio={TILE_ASPECT_RATIO}
          isAnimationActive={false}
          content={(nodeProps) => (
            <CustomTreemapContent
              x={nodeProps.x}
              y={nodeProps.y}
              width={nodeProps.width}
              height={nodeProps.height}
              name={nodeProps.name}
              depth={nodeProps.depth}
              change={nodeProps.change as number | undefined}
              symbol={nodeProps.symbol as string | undefined}
              fullName={nodeProps.fullName as string | undefined}
              price={nodeProps.price as number | null | undefined}
              currency={nodeProps.currency as string | undefined}
              children={nodeProps.children}
              sectorName={nodeProps.sectorName as string | undefined}
              showSectorHeaders={showSectorHeaders}
              tileLookup={tileLookup}
              sectorLayoutRef={sectorLayoutRef}
              glowGreenId={glowGreenId}
              glowRedId={glowRedId}
              onHover={handleHover}
              onLeave={() => setHover(null)}
            />
          )}
        />
      </ResponsiveContainer>
    </div>
  );
}

function HeatmapPanel({
  title,
  universe,
  chartClassName,
  maxTiles,
}: {
  title: string;
  universe: HeatmapUniverse;
  chartClassName: string;
  maxTiles?: number;
}) {
  const { data, loading, error, tileLookup, meta, reload } = useHeatmap(universe, maxTiles);

  return (
    <div className={`${MARKET_PANEL} flex flex-col`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="card-title mb-0">{title}</h3>
        {meta?.asOf ? (
          <p className="text-[10px] text-text-s/70 font-mono tabular-nums shrink-0" title="Quote snapshot time">
            {new Date(meta.asOf).toLocaleString('fi-FI', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
            {meta.cached ? ' · cached' : ''}
          </p>
        ) : null}
      </div>
      <div className={chartClassName}>
        {loading && data.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 opacity-50">
            <RefreshCcw className="w-7 h-7 animate-spin text-accent" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-text-s">Loading…</p>
          </div>
        ) : error && data.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-4">
            <p className="error-banner text-center">{error}</p>
            <button
              type="button"
              onClick={() => void reload()}
              className="px-4 py-2 rounded-xl bg-white/5 border border-border/40 text-[9px] font-black uppercase tracking-widest hover:bg-white/10 transition-all"
            >
              Retry
            </button>
          </div>
        ) : (
          <TreemapChart
            data={data}
            tileLookup={tileLookup}
            showSectorHeaders={universe !== 'omxh25'}
          />
        )}
      </div>
    </div>
  );
}

export function MarketIntelligence() {
  const { overview, loading: overviewLoading, error: overviewError } = useMarketOverview();

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-black tracking-tight text-white uppercase">Market Intelligence</h2>

      {overviewError && (
        <div className="error-banner">
          {overviewError}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch min-h-0">
        <div className="xl:col-span-8 min-h-0">
          <HeatmapPanel
            title="S&P 500"
            universe="sp500"
            chartClassName="w-full h-[min(38vh,380px)] overflow-visible"
            maxTiles={SP500_DISPLAY_CAP}
          />
        </div>
        <div className="xl:col-span-4 min-h-0 flex flex-col">
          <MarketIndexPanel
            quote={overview?.sp500}
            overviewLoading={overviewLoading}
            variant="us"
            panelMinHeight="min-h-[min(38vh,380px)]"
            aiMinHeight="min-h-[min(24vh,260px)]"
          />
        </div>

        <div className="xl:col-span-8">
          <HeatmapPanel
            title="OMX Helsinki 25"
            universe="omxh25"
            chartClassName="w-full h-[min(32vh,300px)] overflow-visible"
          />
        </div>
        <div className="xl:col-span-4 min-h-0 flex flex-col">
          <MarketIndexPanel
            quote={overview?.omxhpi}
            overviewLoading={overviewLoading}
            variant="fi"
            panelMinHeight="min-h-[min(32vh,300px)]"
            aiMinHeight="min-h-[min(18vh,200px)]"
          />
        </div>

        <div className="xl:col-span-12">
          <AlternativeInvestmentsPanel
            alternatives={overview?.alternatives ?? []}
            loading={overviewLoading}
          />
        </div>
      </div>
    </div>
  );
}
