# BÖRS

Local-first portfolio dashboard: holdings, dividends, FIRE projection, and market heatmaps. Data stays on your machine in SQLite; live prices come from Yahoo Finance when you are online.

## Install on Windows (no build required)

You do **not** need Node.js or `npm run build` to use the desktop app.

1. Open **[Releases](https://github.com/HimoLHomer/BORS/releases)** on GitHub.
2. Download the latest **`BORS-Setup-0.x.x.exe`** (one file — nothing else required).
3. Run the installer, then launch **BÖRS** from the Start menu.

Your data is stored under `%APPDATA%\BÖRS\` (portfolio database, optional Gemini key).

**Move data from an older copy:** use **Options → Import JSON** (full backup), or copy `portfolio.db` into `%APPDATA%\BÖRS\` while BÖRS is closed.

Developers who clone the repo can still run from source — see [First-time setup](#first-time-setup-development) below.

## Requirements

- [Node.js](https://nodejs.org/) **22 or newer** (includes `npm`)
- Internet for live quotes, dividends, and heatmaps (no offline price feed)
- Optional: [Gemini API key](https://aistudio.google.com/apikey) for Market Intelligence AI summaries

## First-time setup (development)

1. **Clone the repository**

   ```bash
   git clone https://github.com/HimoLHomer/BORS.git
   cd BORS
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure Gemini (optional, for Market AI summaries)**

   In the app: **Options → Market AI** → paste your key from [Google AI Studio](https://aistudio.google.com/apikey) → **Save key**.

   For development you can instead copy [.env.example](.env.example) to `.env.local` in the project root. Without a key, the rest of BÖRS works; only the Market AI panel is disabled.

4. **Start the app**

   ```bash
   npm run dev
   ```

5. **Open in your browser**

   [http://localhost:3000](http://localhost:3000)

   Optional health check: [http://localhost:3000/api/health/yahoo](http://localhost:3000/api/health/yahoo)

On first run, the app creates `data/portfolio.db` automatically in the project folder.

## Where your data lives

| What | Location |
|------|----------|
| Holdings, history, cash | SQLite: `data/portfolio.db` (default) |
| Custom DB path | Set env var `BORS_DB_PATH` to an absolute path |
| Dividend/FIRE/logo prefs | Synced to SQLite via API (and browser localStorage while using the app) |

**Back up before moving machines**

- **Export JSON** in the app (**Options → Portfolio backup**) — includes holdings, cash, chart prefs, and dividend/FIRE settings (backup format v2).
- Or copy `data/portfolio.db` (and `portfolio.db-wal` / `portfolio.db-shm` if present) while the server is **stopped**.

## How to run the app

| Mode | Commands | URL / data |
|------|----------|------------|
| **Development** | `npm run dev` | [http://localhost:3000](http://localhost:3000) · DB in `./data/` |
| **Production (browser)** | `npm run build` then `npm start` | [http://localhost:3000](http://localhost:3000) · same `./data/` DB |
| **Production (AppData)** | `npm run build` then `.\scripts\launch-bors.ps1` | Same URL · DB in `%LOCALAPPDATA%\BORS\portfolio.db` |
| **Desktop (dev window)** | `npm run build` then `npm run electron:dev` | App window · DB in `%APPDATA%\BORS\` · port **3847** |
| **Windows installer (local build)** | `npm run electron:build` | Installer under `release/` · DB in `%APPDATA%\BORS\` |

On first **Electron** launch, if the AppData database does not exist yet, the app copies `data/portfolio.db` from the project folder when that file is present.

**Gemini in desktop mode:** use **Options → Market AI** in the app (saved to `%APPDATA%\BÖRS\.env.local`).

## Publishing a release (maintainers)

Push a version tag — GitHub Actions builds the Windows installer and attaches it to [Releases](https://github.com/HimoLHomer/BORS/releases). You do not commit `release/` to git.

```bash
git tag v0.1.0
git push origin v0.1.0
```

Or run the **Release** workflow from the Actions tab (manual run uploads an artifact for 30 days).

## Before you build or ship

Run the release checks (uses a temporary database, not your real `data/portfolio.db`):

```bash
npm run test:release
```

Production build (browser server + static UI):

```bash
npm run build
npm start
```

Windows desktop installer (local):

```bash
npm run electron:build
```

Output: `release/BORS-Setup-0.1.0.exe` (requires `npm run build` inside the script; use plenty of RAM — see CI workflow for `NODE_OPTIONS`).

**Native module note:** `better-sqlite3` must match your Node version. If you see `ERR_DLOPEN_FAILED` or `NODE_MODULE_VERSION` errors:

1. Stop all Node/Electron processes.
2. Run `npm run rebuild:native` for `npm run dev` / `npm start`.
3. After `npm run electron:build`, run `npm run rebuild:native` again before returning to dev.

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| Empty dashboard but you had holdings | Open [http://localhost:3000/api/portfolio/assets](http://localhost:3000/api/portfolio/assets) — if JSON lists assets, data is on disk; refresh the page. |
| `better-sqlite3` / DLL errors | `npm run rebuild:native` with server stopped. |
| Port already in use | Stop the other process on 3000 (or 3847 for Electron dev). |
| Market AI errors | Check `GEMINI_API_KEY` in `.env.local` (or AppData `.env.local` for Electron). |
| Desktop app won't start | See `%APPDATA%\BÖRS\bors-startup.log`. End all `BÖRS.exe` in Task Manager, reinstall from latest Release. |
| FIRE data missing after import | Re-export JSON from **Options** (must include `clientSettings`), or copy full `portfolio.db`. |

## Local-first notes

- Portfolio data is stored in **SQLite**, not in git. Do not commit `data/` or `dist/`.
- **Firebase** was removed; there is no cloud account for holdings.
- **Yahoo Finance** is used through the local server for quotes and dividends.
- Asset logos may load from external CDNs; initials are shown when offline or missing.
