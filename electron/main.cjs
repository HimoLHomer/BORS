const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { ensurePortfolioDb } = require("./migrateDb.cjs");

const PORT = Number(process.env.PORT) || 3847;
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
    ELECTRON_RUN_AS_NODE: "1",
  };

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

function waitForServer(maxMs = 30_000) {
  const base = `http://127.0.0.1:${PORT}`;
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      fetch(`${base}/api/portfolio/status`)
        .then((r) => (r.ok ? resolve(base) : Promise.reject(new Error(String(r.status)))))
        .catch(() => {
          if (Date.now() - start > maxMs) reject(new Error("Server did not start in time"));
          else setTimeout(tick, 250);
        });
    };
    tick();
  });
}

async function createWindow() {
  const base = await waitForServer();
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "BÖRS",
    backgroundColor: "#09090b",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(base);
}

app.whenReady().then(async () => {
  try {
    startServer();
    await createWindow();
  } catch (e) {
    console.error(e);
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
