<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/5f1e870b-bf0b-440a-b26a-cd6aef5fabba

## Run Locally

**Project folder:** You can keep this repo anywhere on disk (for example `C:\Projektit\BORS`). If you move or rename its parent folder, reopen the workspace in your editor so paths stay correct.

**Prerequisites:** [Node.js](https://nodejs.org/) (LTS recommended) including **npm**. The shell must resolve `node` and `npm` on your `PATH` (open a new terminal after installing Node on Windows).

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure environment variables. Copy [.env.example](.env.example) to `.env.local` in the project root, then set `GEMINI_API_KEY` to a key from [Google AI Studio](https://aistudio.google.com/apikey). The file is gitignored.
3. Run the app (Express + Vite dev server on port 3000):
   ```bash
   npm run dev
   ```
4. Open [http://localhost:3000](http://localhost:3000). Optional: confirm Yahoo Finance connectivity with [http://localhost:3000/api/health/yahoo](http://localhost:3000/api/health/yahoo).

### Portfolio data (SQLite)

Holdings and portfolio history are stored in a **SQLite file** on your machine (not in git):

- Default path: `data/portfolio.db` (created automatically). WAL files may appear next to it (`portfolio.db-wal`, `portfolio.db-shm`).
- Override with environment variable **`BORS_DB_PATH`** (absolute or relative path to the database file).

Back up regularly: use **Export JSON** in the app (chart settings panel on the dashboard), or copy `data/portfolio.db` while the dev server is stopped.

### Release verification

Before trusting a production build (`npm run build` + `npm start`), run:

```bash
npm run test:release
```

This runs TypeScript checks, portfolio API tests against a **temporary** database (your real `data/portfolio.db` is not touched), then builds and smoke-tests `dist/server.cjs` with the same API and static SPA entry.

If the dashboard looks empty for a moment but holdings should exist, the data is usually still on disk. While the server is running, open [http://localhost:3000/api/portfolio/assets](http://localhost:3000/api/portfolio/assets). An empty UI with JSON holdings listed means a load/hydration issue, not lost SQLite data.

Optional manual check after `test:release`:

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) and confirm holdings match the API.

### Local-first (no Firebase)

- Portfolio data is **SQLite** on disk (`data/portfolio.db` by default). **Firebase was removed** from this project.
- **Fonts** use your OS system stack (no Google Fonts CDN).
- **Gemini** is optional: without `GEMINI_API_KEY`, the AI market panel shows a static note and does not call Google.
- **Yahoo quotes** still go through your **local Express proxy** when the machine is online (Yahoo is external; there is no fully offline price feed unless you add caching later).
