const fs = require("fs");
const path = require("path");

/**
 * Ensure portfolio.db exists under userData; copy from dev/legacy paths on first run.
 * @returns {string} absolute path to portfolio.db
 */
function ensurePortfolioDb(userDataDir) {
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }
  const target = path.join(userDataDir, "portfolio.db");
  if (fs.existsSync(target)) return target;

  const candidates = [];
  if (process.env.BORS_DEV_DB_PATH) {
    candidates.push(path.resolve(process.env.BORS_DEV_DB_PATH));
  }
  if (process.env.BORS_LEGACY_DB_PATH) {
    candidates.push(path.resolve(process.env.BORS_LEGACY_DB_PATH));
  }
  // Repo dev layout when running electron from project root
  candidates.push(path.join(process.cwd(), "data", "portfolio.db"));

  for (const src of candidates) {
    if (!src || !fs.existsSync(src)) continue;
    fs.copyFileSync(src, target);
    for (const ext of ["-wal", "-shm"]) {
      const side = src + ext;
      if (fs.existsSync(side)) {
        try {
          fs.copyFileSync(side, target + ext);
        } catch {
          /* ignore */
        }
      }
    }
    console.log("[bors] Migrated portfolio database from", src);
    return target;
  }

  return target;
}

module.exports = { ensurePortfolioDb };
