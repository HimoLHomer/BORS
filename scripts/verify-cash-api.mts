/**
 * Spins up Express + portfolio routes only (no Vite), hits GET/PUT /api/portfolio/cash, then exits.
 * Run: npx tsx scripts/verify-cash-api.mts
 */
import express from "express";
import { registerPortfolioRoutes } from "../server/portfolio.ts";

const app = express();
app.use(express.json());
registerPortfolioRoutes(app);

const server = app.listen(0, "127.0.0.1", async () => {
  const addr = server.address();
  const port = typeof addr === "object" && addr && "port" in addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;

  const getRes = await fetch(`${base}/api/portfolio/cash`);
  const getCt = getRes.headers.get("content-type") || "";
  const getBody = await getRes.text();
  console.log("GET /api/portfolio/cash", getRes.status, getCt.slice(0, 40));
  if (!getCt.includes("application/json")) {
    console.error("Expected JSON from GET cash; got:", getBody.slice(0, 120));
    server.close();
    process.exit(1);
  }
  const before = JSON.parse(getBody) as { amountEur?: number };

  const putRes = await fetch(`${base}/api/portfolio/cash`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amountEur: 123.45 }),
  });
  const putBody = await putRes.text();
  console.log("PUT /api/portfolio/cash", putRes.status, putBody);

  const get2 = await fetch(`${base}/api/portfolio/cash`);
  const after = (await get2.json()) as { amountEur?: number };
  console.log("GET after PUT", get2.status, after);

  await fetch(`${base}/api/portfolio/cash`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amountEur: before.amountEur ?? 0 }),
  });
  console.log("Restored cash to", before.amountEur ?? 0);

  server.close();
  if (putRes.status !== 200 || after.amountEur !== 123.45) {
    console.error("Cash API verification failed");
    process.exit(1);
  }
  console.log("OK: cash GET/PUT round-trip works on current code.");
});
