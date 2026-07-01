import fs from "fs";

const lines = fs.readFileSync("src/App.tsx", "utf8").split("\n");

// Remove lines 74-338 (helpers, modals, header) and 1846-2409 (nav + add modal + trailing comment)
// 1-indexed: keep 1-73, 339-1845, 2410-end
const kept = [...lines.slice(0, 73), ...lines.slice(338, 1845), ...lines.slice(2409)];

const extraImports = `import { View, dedupeHistoryByDate, normalizeCashAmountEur, parseCashInputEur, formatCashEurTwoDecimals, isAbortError } from './portfolioHelpers';
import { HistoryPointModal } from './HistoryPointModal';
import { LoadingScreen, AppHeader } from './AppHeader';
import { NavButton } from './AppNav';
import { AddAssetModal } from './AddAssetModal';
`;

// Insert after last import block (line 72 is portfolioChartRange import)
const insertAt = kept.findIndex((l) => l.includes("from './portfolioChartRange'")) + 1;
kept.splice(insertAt, 0, extraImports.trim());

// Replace Header with AppHeader in JSX
const out = kept.join("\n").replace(/<Header\b/g, "<AppHeader").replace(/\bHeader\b/g, (m, offset, s) => {
  // avoid replacing AppHeader twice - only replace component usage
  return m;
});

// Fix: only replace <Header with <AppHeader - already done. Replace closing if any Header references in props - the component was named Header

fs.writeFileSync("src/App.tsx", out);
console.log("patch-app: ok, lines", out.split("\n").length);
