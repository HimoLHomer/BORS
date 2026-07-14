/**
 * Fetches S&P 500 and OMX Helsinki 25 constituents from English Wikipedia
 * via the MediaWiki parse API. Unofficial but widely used.
 */

export type MarketConstituent = {
  symbol: string;
  name: string;
  sector: string;
};

const WIKI_API = "https://en.wikipedia.org/w/api.php";
const USER_AGENT = "BORS/0.1.10 (market constituent sync; +https://github.com/local/bors)";

/** Align Wikipedia GICS labels with sectors used in bundled OMX heatmap JSON. */
const OMX_SECTOR_ALIASES: Record<string, string> = {
  "Information Technology": "Technology",
};

function normalizeSector(raw: string, universe: "sp500" | "omxh25"): string {
  const trimmed = raw.trim();
  if (universe === "omxh25") {
    return OMX_SECTOR_ALIASES[trimmed] ?? trimmed;
  }
  return trimmed;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTableRows(tableHtml: string): string[][] {
  const rows: string[][] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(tableHtml)) !== null) {
    const cells: string[] = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1]!)) !== null) {
      cells.push(stripHtml(cellMatch[1]!));
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function extractTableById(html: string, id: string): string | null {
  const re = new RegExp(`<table[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/table>`, "i");
  const match = re.exec(html);
  return match ? match[0]! : null;
}

function extractOmxConstituentsTable(html: string): string | null {
  const tableRe = /<table[^>]*class="[^"]*wikitable[^"]*"[^>]*>([\s\S]*?)<\/table>/gi;
  let match: RegExpExecArray | null;
  while ((match = tableRe.exec(html)) !== null) {
    const table = match[0]!;
    if (!/Ticker/i.test(table) || !/\.HE/i.test(table)) continue;
    return table;
  }
  return null;
}

async function fetchWikipediaHtml(page: string, retries = 3): Promise<string> {
  const params = new URLSearchParams({
    action: "parse",
    page,
    prop: "text",
    format: "json",
    formatversion: "2",
  });
  const url = `${WIKI_API}?${params}`;

  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status} for ${page}`);
      const json = (await res.json()) as {
        error?: { code?: string; info?: string };
        parse?: { text?: string };
      };
      if (json.error) {
        throw new Error(json.error.info ?? json.error.code ?? "Wikipedia API error");
      }
      const text = json.parse?.text;
      if (!text) throw new Error(`Wikipedia returned no HTML for ${page}`);
      return text;
    } catch (e) {
      lastError = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }
  throw lastError;
}

function normalizeSp500Symbol(raw: string): string {
  return raw.trim().replace(/\s+/g, "");
}

function normalizeOmxSymbol(raw: string): string {
  return raw.trim().toUpperCase();
}

export async function fetchSp500Constituents(): Promise<MarketConstituent[]> {
  const html = await fetchWikipediaHtml("List_of_S&P_500_companies");
  const table = extractTableById(html, "constituents");
  if (!table) throw new Error("S&P 500 constituents table not found on Wikipedia");

  const rows = parseTableRows(table);
  const header = rows[0]?.map((c) => c.toLowerCase()) ?? [];
  const symIdx = header.findIndex((h) => h.includes("symbol"));
  const nameIdx = header.findIndex((h) => h.includes("security") || h === "company");
  const sectorIdx = header.findIndex((h) => h.includes("gics") && h.includes("sector"));

  if (symIdx < 0 || nameIdx < 0 || sectorIdx < 0) {
    throw new Error("Unexpected S&P 500 Wikipedia table headers");
  }

  const out: MarketConstituent[] = [];
  for (const row of rows.slice(1)) {
    const symbol = normalizeSp500Symbol(row[symIdx] ?? "");
    const name = (row[nameIdx] ?? "").trim();
    const sector = normalizeSector(row[sectorIdx] ?? "", "sp500");
    if (!symbol || !name || !sector) continue;
    out.push({ symbol, name, sector });
  }

  if (out.length < 490 || out.length > 510) {
    throw new Error(`S&P 500 count out of range: ${out.length} (expected 490–510)`);
  }

  const seen = new Set<string>();
  for (const c of out) {
    if (seen.has(c.symbol)) throw new Error(`Duplicate S&P symbol: ${c.symbol}`);
    seen.add(c.symbol);
  }

  return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export async function fetchOmxh25Constituents(): Promise<MarketConstituent[]> {
  const html = await fetchWikipediaHtml("OMX_Helsinki_25");
  const table = extractOmxConstituentsTable(html);
  if (!table) throw new Error("OMX Helsinki 25 constituents table not found on Wikipedia");

  const rows = parseTableRows(table);
  const header = rows[0]?.map((c) => c.toLowerCase()) ?? [];
  const symIdx = header.findIndex((h) => h.includes("ticker"));
  const nameIdx = header.findIndex((h) => h.includes("company"));
  const sectorIdx = header.findIndex((h) => h.includes("gics") || h.includes("sector"));

  if (symIdx < 0 || nameIdx < 0 || sectorIdx < 0) {
    throw new Error("Unexpected OMX Helsinki 25 Wikipedia table headers");
  }

  const out: MarketConstituent[] = [];
  for (const row of rows.slice(1)) {
    const symbol = normalizeOmxSymbol(row[symIdx] ?? "");
    const name = (row[nameIdx] ?? "").trim();
    const sector = normalizeSector(row[sectorIdx] ?? "", "omxh25");
    if (!symbol || !name || !sector) continue;
    if (!symbol.endsWith(".HE")) continue;
    out.push({ symbol, name, sector });
  }

  if (out.length !== 25) {
    throw new Error(`OMX Helsinki 25 count invalid: ${out.length} (expected 25)`);
  }

  const seen = new Set<string>();
  for (const c of out) {
    if (seen.has(c.symbol)) throw new Error(`Duplicate OMX symbol: ${c.symbol}`);
    seen.add(c.symbol);
  }

  return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
}
