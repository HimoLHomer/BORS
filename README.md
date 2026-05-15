# BÖRS

Local-first portfolio dashboard: holdings, dividends, FIRE projection, and market heatmaps. Data stays on your machine in SQLite; live prices come from Yahoo Finance when you are online.

## Requirements

- [Node.js](https://nodejs.org/) **22 or newer** (includes `npm`)
- Internet for live quotes, dividends, and heatmaps (no offline price feed)
- Optional: [Gemini API key](https://aistudio.google.com/apikey) for Market Intelligence AI summaries

## First-time setup (development)

1. **Clone the repository**

   ```bash
   git clone https://github.com/Vauhtikeskus/BORS.git
   cd BORS
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment (optional Gemini)**

   Copy [.env.example](.env.example) to `.env.local` in the project root and set `GEMINI_API_KEY`. The file is gitignored. Without it, the market AI panel shows a static note instead of calling Google.

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

- **Export JSON** in the app (Dashboard → chart settings) — includes holdings, cash, chart prefs, and dividend/FIRE settings (backup format v2).
- Or copy `data/portfolio.db` (and `portfolio.db-wal` / `portfolio.db-shm` if present) while the server is **stopped**.

## How to run the app

| Mode | Commands | URL / data |
|------|----------|------------|
| **Development** | `npm run dev` | [http://localhost:3000](http://localhost:3000) · DB in `./data/` |
| **Production (browser)** | `npm run build` then `npm start` | [http://localhost:3000](http://localhost:3000) · same `./data/` DB |
| **Production (AppData)** | `npm run build` then `.\scripts\launch-bors.ps1` | Same URL · DB in `%LOCALAPPDATA%\BORS\portfolio.db` |
| **Desktop (dev window)** | `npm run build` then `npm run electron:dev` | App window · DB in `%APPDATA%\BORS\` · port **3847** |
| **Windows installer** | `npm run electron:build` | Installer under `release/` · DB in `%APPDATA%\BORS\` |

On first **Electron** launch, if the AppData database does not exist yet, the app copies `data/portfolio.db` from the project folder when that file is present.

**Gemini in desktop mode:** create `%APPDATA%\BORS\.env.local` with `GEMINI_API_KEY=...` (see `.env.example`).

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

Windows desktop installer:

```bash
npm run build
npm run electron:build
```

Output: `release/` (NSIS installer).

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

## Local-first notes

- Portfolio data is stored in **SQLite**, not in git. Do not commit `data/` or `dist/`.
- **Firebase** was removed; there is no cloud account for holdings.
- **Yahoo Finance** is used through the local server for quotes and dividends.
- Asset logos may load from external CDNs; initials are shown when offline or missing.
