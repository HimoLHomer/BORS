/**
 * One-off: converts assets/market/sp500-constituents.csv → assets/market/sp500.json
 * Run: npx tsx scripts/build-sp500-json.mts
 */
import fs from 'fs';
import path from 'path';

const csvPath = path.join(process.cwd(), 'assets/market/sp500-constituents.csv');
const outPath = path.join(process.cwd(), 'assets/market/sp500.json');

const raw = fs.readFileSync(csvPath, 'utf8');
const lines = raw.split(/\r?\n/).filter(Boolean);
const header = lines[0]!.split(',');
const symIdx = header.findIndex((h) => h.replace(/"/g, '') === 'Symbol');
const nameIdx = header.findIndex((h) => h.replace(/"/g, '') === 'Security');
const sectorIdx = header.findIndex((h) => h.replace(/"/g, '') === 'GICS Sector');

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (c === ',' && !inQ) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

const rows: { symbol: string; name: string; sector: string }[] = [];
for (let i = 1; i < lines.length; i++) {
  const cols = parseCsvLine(lines[i]!);
  const symbol = cols[symIdx]?.trim();
  const name = cols[nameIdx]?.trim();
  const sector = cols[sectorIdx]?.trim() || 'Other';
  if (!symbol) continue;
  rows.push({ symbol, name: name || symbol, sector });
}

fs.writeFileSync(outPath, JSON.stringify(rows, null, 0));
console.log(`Wrote ${rows.length} constituents to ${outPath}`);
