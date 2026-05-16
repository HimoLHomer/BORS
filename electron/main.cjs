const { app, BrowserWindow, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { ensurePortfolioDb } = require("./migrateDb.cjs");

// Packaged Chromium can fail loading loopback behind proxy / hardened network sandbox.
app.commandLine.appendSwitch("disable-features", "NetworkServiceSandbox");
app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>");
app.commandLine.appendSwitch("proxy-server", "direct://");

const PORT = Number(process.env.PORT) || 3847;
/** Chromium on Windows often fails [::1]; always load the UI over IPv4 loopback. */
const LOOPBACK_BASE = `http://127.0.0.1:${PORT}`;
let serverProcess = null;
let mainWindow = null;

function userDataDir() {
  return app.getPath("userData");
}

function loadUserEnv() {
  const dir = userDataDir();
  const envPath = path.join(dir, ".env.local");
  if (!fs.existsSync(envPath)) {
    const example = path.join(dir, ".env.example");
    if (!fs.existsSync(example)) {
      fs.writeFileSync(
        example,
        "# Optional: Gemini market AI\nGEMINI_API_KEY=\n# GEMINI_MODEL=gemini-2.0-flash-lite\n",
        "utf8"
      );
    }
    return;
  }
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}

function projectRoot() {
  return app.isPackaged ? app.getAppPath() : path.join(__dirname, "..");
}

function applyServerEnv(env) {
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) process.env[key] = value;
  }
}

/** Packaged Windows builds fail to spawn BÖRS.exe with ELECTRON_RUN_AS_NODE (ENOENT / Ö in path). */
function startServerInProcess(root, serverEntry, env) {
  applyServerEnv({ ...env, BORS_APP_ROOT: root });
  require(serverEntry);
}

function startServer() {
  const root = projectRoot();
  const serverEntry = path.join(root, "dist", "server.cjs");
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Missing server bundle: ${serverEntry}. Run npm run build first.`);
  }

  const dbPath = ensurePortfolioDb(userDataDir());
  loadUserEnv();

  const env = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(PORT),
    BORS_DB_PATH: dbPath,
    BORS_USER_DATA: userDataDir(),
    BORS_LISTEN_HOST: "127.0.0.1",
    BORS_ELECTRON: "1",
    ELECTRON_RUN_AS_NODE: "1",
  };

  if (app.isPackaged) {
    startServerInProcess(root, serverEntry, env);
    return;
  }

  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });

  serverProcess.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error("[bors] Server exited with code", code);
    }
    serverProcess = null;
  });
}

function stopServer() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
  serverProcess = null;
}

function waitForServer(maxMs = 45_000) {
  const probe = `${LOOPBACK_BASE}/api/portfolio/status`;
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      fetch(probe)
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          resolve(LOOPBACK_BASE);
        })
        .catch(() => {
          if (Date.now() - start > maxMs) {
            reject(new Error(`Server did not start in time (${probe})`));
          } else setTimeout(tick, 200);
        });
    };
    tick();
  });
}

/** Retry IPv4 loopback only — Node fetch can succeed on [::1] while Chromium cannot load it. */
async function loadAppPage(webContents) {
  const tries = [`${LOOPBACK_BASE}/`, `${LOOPBACK_BASE}/index.html`];
  let lastErr = null;
  for (let round = 0; round < 15; round++) {
    for (const url of tries) {
      try {
        await webContents.loadURL(url);
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    await new Promise((r) => setTimeout(r, 400 + round * 75));
  }
  throw lastErr || new Error(`loadURL failed for ${LOOPBACK_BASE}`);
}

async function createWindow() {
  await waitForServer();
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "BÖRS",
    show: false,
    backgroundColor: "#09090b",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: !app.isPackaged,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("did-fail-load", (_e, code, text, url) => {
    console.error("[bors] did-fail-load", code, text, url);
  });

  await loadAppPage(mainWindow.webContents);
}

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.stack || reason.message : String(reason);
  console.error("[bors] unhandledRejection", reason);
  dialog.showErrorBox("BÖRS could not start", msg);
  app.exit(1);
});

app.whenReady().then(async () => {
  try {
    startServer();
    await createWindow();
  } catch (e) {
    const msg = e instanceof Error ? (e.stack || e.message) : String(e);
    console.error(e);
    dialog.showErrorBox("BÖRS could not start", msg);
    app.exit(1);
  }
});

app.on("window-all-closed", () => {
  stopServer();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopServer();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
