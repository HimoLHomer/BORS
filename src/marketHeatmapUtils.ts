/** Heatmap helpers for Market Intelligence panels. */

export type MarketHeatmapMover = {
  symbol: string;
  name: string;
  changePercent: number;
};

export type MarketSectorBreadth = {
  leadingSector: string;
  leadingAvgPct: number;
  laggingSector: string;
  laggingAvgPct: number;
};

export function pickTopHeatmapMovers(
  tiles: MarketHeatmapMover[],
  limit = 1
): { gainers: MarketHeatmapMover[]; losers: MarketHeatmapMover[] } {
  const valid = tiles.filter((t) => t.symbol && Number.isFinite(t.changePercent));
  const sorted = [...valid].sort((a, b) => b.changePercent - a.changePercent);
  const gainers = sorted.filter((t) => t.changePercent > 0).slice(0, limit);
  const losers = sorted.filter((t) => t.changePercent < 0).slice(-limit).reverse();
  return { gainers, losers };
}

export function computeSectorBreadth(
  sectors: { name: string; children: { change: number }[] }[]
): MarketSectorBreadth | undefined {
  const avgs: { name: string; avg: number }[] = [];
  for (const s of sectors) {
    if (!s.children.length) continue;
    const avg = s.children.reduce((sum, c) => sum + c.change, 0) / s.children.length;
    if (Number.isFinite(avg)) avgs.push({ name: s.name, avg });
  }
  if (avgs.length < 2) return undefined;
  const sorted = [...avgs].sort((a, b) => b.avg - a.avg);
  return {
    leadingSector: sorted[0]!.name,
    leadingAvgPct: sorted[0]!.avg,
    laggingSector: sorted[sorted.length - 1]!.name,
    laggingAvgPct: sorted[sorted.length - 1]!.avg,
  };
}
