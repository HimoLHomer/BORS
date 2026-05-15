/**
 * Builds the app, starts dist/server.cjs in production mode with a temp DB, and smoke-tests API + static SPA.
 * Run: npm run verify:prod
 */
import { execSync, spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import {
  assertPortfolioApi,
  createTempDbPath,
  removeDbFiles,
  seedPortfolioViaHttp,
  waitForServer,
} from "./portfolio-verify-lib.mts";

const projectRoot = process.cwd();
const serverBundle = path.join(projectRoot, "dist", "server.cjs");
const dbPath = createTempDbPath("bors-verify-prod");
const port = 38_000 + Math.floor(Math.random() * 2_000);

function runBuild(): void {
  console.log("Running npm run build…");
  execSync("npm run build", { cwd: projectRoot, stdio: "inherit", env: process.env });
  if (!fs.existsSync(serverBundle)) {
    throw new Error(`Missing ${serverBundle} after build`);
  }
  const indexHtml = path.join(projectRoot, "dist", "index.html");
  if (!fs.existsSync(indexHtml)) {
    throw new Error(`Missing ${indexHtml} after build`);
  }
}

function startProductionServer(): ChildProcess {
  return spawn(process.execPath, [serverBundle], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      BORS_DB_PATH: dbPath,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function assertStaticSpa(base: string): Promise<void> {
  const res = await fetch(`${base}/`);
  if (!res.ok) {
    throw new Error(`GET / failed: HTTP ${res.status}`);
  }
  const html = await res.text();
  if (!html.includes('id="root"') && !html.includes("id='root'")) {
    throw new Error("GET / HTML missing root mount element");
  }
}

let child: ChildProcess | null = null;

function shutdownChild(): void {
  if (child && !child.killed) {
    child.kill();
  }
  child = null;
}

try {
  runBuild();
  child = startProductionServer();
  const base = `http://127.0.0.1:${port}`;

  child.stderr?.on("data", (buf) => {
    const s = buf.toString();
    if (s.trim()) console.error("[server stderr]", s.trimEnd());
  });

  let failed = false;
  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`Production server exited early with code ${code}`);
      failed = true;
    }
  });

  try {
    await waitForServer(base);
    await seedPortfolioViaHttp(base);
    await assertPortfolioApi(base);
    await assertStaticSpa(base);
    console.log("OK: production build serves portfolio API and static SPA.");
  } catch (e) {
    console.error("Production build verification failed:", e instanceof Error ? e.message : e);
    failed = true;
  }

  shutdownChild();
  await new Promise((r) => setTimeout(r, 200));
  removeDbFiles(dbPath);
  process.exitCode = failed ? 1 : 0;
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  shutdownChild();
  removeDbFiles(dbPath);
  process.exitCode = 1;
}

process.on("SIGINT", () => {
  shutdownChild();
  removeDbFiles(dbPath);
  process.exitCode = 130;
});
