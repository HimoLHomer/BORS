/**
 * Portfolio API verification against a temporary SQLite file (never touches data/portfolio.db).
 * Run: npm run verify:portfolio
 */
import express from "express";
import {
  assertPortfolioApi,
  createTempDbPath,
  removeDbFiles,
  seedPortfolioViaHttp,
} from "./portfolio-verify-lib.mts";

const dbPath = createTempDbPath("bors-verify-portfolio");
process.env.BORS_DB_PATH = dbPath;

const { registerPortfolioRoutes } = await import("../server/portfolio.ts");

const app = express();
app.use(express.json());
registerPortfolioRoutes(app);

let exitCode = 0;
const server = app.listen(0, "127.0.0.1", async () => {
  const addr = server.address();
  const port = typeof addr === "object" && addr && "port" in addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;

  try {
    await seedPortfolioViaHttp(base);
    await assertPortfolioApi(base);
    console.log("OK: portfolio GET/export round-trip works on current code.");
  } catch (e) {
    console.error("Portfolio API verification failed:", e instanceof Error ? e.message : e);
    exitCode = 1;
  } finally {
    server.close(() => {
      removeDbFiles(dbPath);
      process.exitCode = exitCode;
    });
  }
});

server.on("error", (e) => {
  console.error("Server listen failed:", e);
  removeDbFiles(dbPath);
  process.exit(1);
});
