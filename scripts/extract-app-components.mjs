import fs from "fs";

const app = fs.readFileSync("src/App.tsx", "utf8");
const lines = app.split("\n");

function slice(start, end) {
  return lines.slice(start - 1, end).join("\n");
}

// Helpers (lines 84-122) + View enum (76-82)
const helpers = `${slice(76, 82)}\n\n${slice(84, 122)}`;
fs.writeFileSync(
  "src/portfolioHelpers.ts",
  `import { parseDecimalInput, formatDecimalEn } from './formatNumber';\nimport type { HistoryPoint } from './types';\n\n${helpers.replace(/^enum View/, "export enum View")}\n`
);

fs.writeFileSync(
  "src/HistoryPointModal.tsx",
  `import React, { useState } from 'react';\nimport { X } from 'lucide-react';\nimport { motion } from 'motion/react';\nimport type { HistoryPoint } from './types';\nimport { formatDecimalEn, formatDecimalInputEn, parseDecimalInput } from './formatNumber';\nimport { todayIsoDateHelsinki } from './formatDate';\nimport { EurAmountInput } from './EurAmountField';\n\n${slice(124, 265).replace(/^const HistoryPointModal/, "export const HistoryPointModal")}\n`
);

fs.writeFileSync(
  "src/AppHeader.tsx",
  `import React from 'react';\nimport { RefreshCcw } from 'lucide-react';\nimport { BorsMark } from './BorsMark';\n\n${slice(269, 280).replace(/^const LoadingScreen/, "export const LoadingScreen")}\n\n${slice(282, 338).replace(/^const Header/, "export const AppHeader")}\n`
);

fs.writeFileSync(
  "src/AppNav.tsx",
  `import React from 'react';\n\n${slice(1848, 1883).replace(/^const NAV_SHORT/, "const NAV_SHORT").replace(/^const NavButton/, "export const NavButton")}\n`
);

const addModal = slice(1885, 2407)
  .replace(/^const AddAssetModal/, "export const AddAssetModal")
  .replace(
    /^import React/m,
    `import React, { useState, useMemo } from 'react';\nimport { X, Search, RefreshCcw } from 'lucide-react';\nimport { motion } from 'motion/react';\nimport type { Asset } from './types';\nimport { formatCurrency } from './formatCurrency';\nimport { mergeHoldingPurchase } from './mergeHoldingPurchase';\nimport {\n  formatDecimalEn,\n  formatDecimalInputEn,\n  parseDecimalInput,\n  parseShareInput,\n  formatShareInput,\n  formatShares,\n  sanitizeShareDraft,\n} from './formatNumber';\nimport { EurAmountInput } from './EurAmountField';\n\n// placeholder`
  );

// Fix addModal - the replace on import won't work since there's no import at start. Write properly:
const addModalBody = slice(1885, 2407).replace(/^const AddAssetModal/, "export const AddAssetModal");
fs.writeFileSync(
  "src/AddAssetModal.tsx",
  `import React, { useState, useMemo } from 'react';\nimport { X, Search, RefreshCcw } from 'lucide-react';\nimport { motion } from 'motion/react';\nimport type { Asset } from './types';\nimport { formatCurrency } from './formatCurrency';\nimport { mergeHoldingPurchase } from './mergeHoldingPurchase';\nimport {\n  formatDecimalEn,\n  formatDecimalInputEn,\n  parseDecimalInput,\n  parseShareInput,\n  formatShareInput,\n  formatShares,\n  sanitizeShareDraft,\n} from './formatNumber';\nimport { EurAmountInput } from './EurAmountField';\n\n${addModalBody}\n`
);

console.log("extract-app-components: wrote helper files");
