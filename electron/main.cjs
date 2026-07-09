const { app, BrowserWindow, shell, dialog, ipcMain, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { ensurePortfolioDb } = require("./migrateDb.cjs");

const PORT = Number(process.env.PORT) || 3847;
const LOOPBACK_BASE = `http://127.0.0.1:${PORT}`;
let serverProcess = null;
let mainWindow = null;
let startupLogPath = "";

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    if (startupLogPath) fs.appendFileSync(startupLogPath, line);
  } catch {
    /* ignore */
  }
  console.log(msg);
}

function showFatal(title, message) {
  log(`${title}: ${message}`);
  try {
    dialog.showErrorBox(title, message);
  } catch {
    /* headless */
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  showFatal("BÖRS", "BÖRS is already running. Check the taskbar or close it in Task Manager (BÖRS.exe).");
  app.quit();
} else {
  try {
    const cacheDir = path.join(app.getPath("userData"), "chromium-cache");
    fs.mkdirSync(cacheDir, { recursive: true });
    app.commandLine.appendSwitch("disk-cache-dir", cacheDir);
  } catch {
    /* ignore */
  }
  app.commandLine.appendSwitch("disable-features", "NetworkServiceSandbox");
  app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>");
  app.commandLine.appendSwitch("proxy-server", "direct://");

  ipcMain.handle("bors:fetch", async (_event, { url, init }) => {
    const res = await fetch(url, {
      method: init?.method || "GET",
      headers: init?.headers,
      body: init?.body,
    });
    const bodyText = await res.text();
    const headers = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    return { status: res.status, statusText: res.statusText, headers, bodyText };
  });
}

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
        "# Optional environment overrides\n# See .env.example\n",
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

/** Unpacked dist (asarUnpack); node_modules stay in app.asar. */
function packagedDistDir() {
  const dist = path.join(process.resourcesPath, "app.asar.unpacked", "dist");
  if (fs.existsSync(path.join(dist, "index.html"))) return dist;
  return path.join(projectRoot(), "dist");
}

function packagedServerEntry() {
  const entry = path.join(packagedDistDir(), "server.cjs");
  if (fs.existsSync(entry)) return entry;
  return path.join(projectRoot(), "dist", "server.cjs");
}

function packagedNodePath() {
  const dirs = [
    path.join(process.resourcesPath, "app.asar.unpacked", "node_modules"),
    path.join(projectRoot(), "node_modules"),
  ].filter((d) => fs.existsSync(d));
  return dirs.join(path.delimiter);
}

function serverEnv(root, dbPath) {
  const env = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(PORT),
    BORS_DB_PATH: dbPath,
    BORS_USER_DATA: userDataDir(),
    BORS_LISTEN_HOST: "127.0.0.1",
    BORS_APP_ROOT: app.isPackaged ? projectRoot() : root,
  };
  if (app.isPackaged) {
    env.BORS_DIST_ROOT = packagedDistDir();
    const nodePath = packagedNodePath();
    if (nodePath) {
      env.NODE_PATH = env.NODE_PATH ? `${nodePath}${path.delimiter}${env.NODE_PATH}` : nodePath;
    }
  }
  return env;
}

function attachServerLogs(child) {
  child.stdout?.on("data", (d) => log(`[server] ${String(d).trim()}`));
  child.stderr?.on("data", (d) => log(`[server] ${String(d).trim()}`));
}

function forkServerProcess(serverEntry, env, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverEntry], {
      cwd,
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "pipe",
      windowsHide: true,
    });
    const timeout = setTimeout(() => reject(new Error("API server process did not start")), 60_000);
    child.once("spawn", () => {
      clearTimeout(timeout);
      serverProcess = child;
      attachServerLogs(child);
      resolve();
    });
    child.on("exit", (code) => log(`API server exited (${code})`));
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function startServer() {
  const root = projectRoot();
  const serverEntry = app.isPackaged ? packagedServerEntry() : path.join(root, "dist", "server.cjs");
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Missing server bundle: ${serverEntry}. Run npm run build first.`);
  }

  const dbPath = ensurePortfolioDb(userDataDir());
  loadUserEnv();
  const env = serverEnv(root, dbPath);
  const cwd = app.isPackaged ? path.dirname(serverEntry) : root;

  log(app.isPackaged ? "Starting API server (child process)" : "Starting API server (dev)");
  await forkServerProcess(serverEntry, env, cwd);
}

function stopServer() {
  if (serverProcess && "kill" in serverProcess) {
    serverProcess.kill();
  }
  serverProcess = null;
}

function waitForServer(maxMs = 60_000) {
  const probe = `${LOOPBACK_BASE}/api/portfolio/status`;
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      fetch(probe)
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          resolve();
        })
        .catch((err) => {
          if (Date.now() - start > maxMs) {
            reject(new Error(`Server did not respond (${probe}): ${err}`));
          } else setTimeout(tick, 250);
        });
    };
    tick();
  });
}

async function loadHttpUi(win) {
  const url = `${LOOPBACK_BASE}/`;
  log(`Loading UI: ${url}`);
  let lastErr = null;
  for (let round = 0; round < 20; round++) {
    try {
      await win.loadURL(url);
      return;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 500 + round * 100));
    }
  }
  throw lastErr || new Error(`Could not load ${url}`);
}

async function openBrowserFallback(reason) {
  log(`Falling back to system browser: ${reason}`);
  await shell.openExternal(`${LOOPBACK_BASE}/`);
  dialog.showMessageBox({
    type: "info",
    title: "BÖRS",
    message: "BÖRS is running in your browser",
    detail: `The desktop window could not open (${reason}).\n\nBÖRS was opened at:\n${LOOPBACK_BASE}\n\nKeep this window open while you use the app.`,
  });
}

function windowIcon() {
  const candidates = [
    path.join(__dirname, "..", "resources", "icon.png"),
    path.join(process.resourcesPath, "icon.png"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img;
    }
  }
  return undefined;
}

async function createWindow() {
  await waitForServer();

  const icon = windowIcon();
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "BÖRS",
    icon,
    show: true,
    backgroundColor: "#09090b",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  try {
    await loadHttpUi(mainWindow);
    log("BÖRS window ready");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    mainWindow.destroy();
    mainWindow = null;
    await openBrowserFallback(msg);
    app.quit();
  }
}

if (gotSingleInstanceLock) {
  process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? reason.stack || reason.message : String(reason);
    showFatal("BÖRS could not start", msg);
    app.exit(1);
  });

  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else {
      void createWindow().catch((e) => {
        showFatal("BÖRS could not start", e instanceof Error ? e.message : String(e));
        app.exit(1);
      });
    }
  });

  app.whenReady().then(async () => {
    startupLogPath = path.join(userDataDir(), "bors-startup.log");
    log("BÖRS starting");
    try {
      await startServer();
      await createWindow();
    } catch (e) {
      const msg = e instanceof Error ? (e.stack || e.message) : String(e);
      try {
        await openBrowserFallback(msg);
      } catch {
        showFatal("BÖRS could not start", msg);
      }
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
}
