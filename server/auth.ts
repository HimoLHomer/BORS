import crypto from "crypto";
import express, { type Express, type NextFunction, type Request, type Response } from "express";

/**
 * Single-user password login for hosted deployments.
 *
 * Enabled only when BORS_PASSWORD_HASH is set (see scripts/hash-password.mjs); the desktop app
 * and local dev run without it. Sessions are stateless signed cookies, so they survive restarts
 * as long as BORS_SESSION_SECRET stays the same.
 */

const COOKIE = "bors_session";
const SESSION_DAYS = 30;
const MAX_FAILS = 10;
const FAIL_WINDOW_MS = 15 * 60 * 1000;

export function authEnabled(): boolean {
  return Boolean(process.env.BORS_PASSWORD_HASH?.trim());
}

/** "scrypt:<salt b64>:<hash b64>" */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("base64")}:${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.trim().split(":");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, "base64"), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function sessionSecret(): string {
  const s = process.env.BORS_SESSION_SECRET?.trim();
  if (s) return s;
  // Fallback: tie sessions to the password hash (logging in again is needed if it changes).
  return `derived:${process.env.BORS_PASSWORD_HASH ?? ""}`;
}

function sign(value: string): string {
  return crypto.createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

function makeSessionToken(now = Date.now()): string {
  const exp = String(now + SESSION_DAYS * 86_400_000);
  return `${exp}.${sign(exp)}`;
}

function validSessionToken(token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < now) return false;
  const expected = Buffer.from(sign(exp));
  const got = Buffer.from(sig);
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function setSessionCookie(req: Request, res: Response, token: string, maxAgeSec: number): void {
  const secure = req.secure ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure}`
  );
}

const fails = new Map<string, { count: number; first: number }>();

function tooManyFails(ip: string, now = Date.now()): boolean {
  const f = fails.get(ip);
  if (!f) return false;
  if (now - f.first > FAIL_WINDOW_MS) {
    fails.delete(ip);
    return false;
  }
  return f.count >= MAX_FAILS;
}

function recordFail(ip: string, now = Date.now()): void {
  const f = fails.get(ip);
  if (!f || now - f.first > FAIL_WINDOW_MS) fails.set(ip, { count: 1, first: now });
  else f.count += 1;
}

function safeNext(raw: unknown): string {
  const s = typeof raw === "string" ? raw : "/";
  // Same-site paths only: browsers treat "\" like "/", so "/\evil.com" would become "//evil.com".
  return s.startsWith("/") && !s.startsWith("//") && !s.includes("\\") ? s : "/";
}

function loginPage(error?: string, next = "/"): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>BÖRS · Sign in</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0a0a0b; color: #e4e4e7;
         font: 14px/1.5 ui-sans-serif, system-ui, "Segoe UI", sans-serif; padding: 16px; box-sizing: border-box; }
  form { width: 100%; max-width: 320px; background: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 28px; }
  h1 { margin: 0 0 4px; font-size: 22px; font-weight: 900; letter-spacing: -0.02em; }
  p { margin: 0 0 20px; color: #a1a1aa; font-size: 12px; }
  label { display: block; font-size: 10px; font-weight: 700; letter-spacing: .15em; text-transform: uppercase; color: #a1a1aa; margin-bottom: 6px; }
  input { width: 100%; box-sizing: border-box; background: #0a0a0b; border: 1px solid #27272a; border-radius: 10px; color: #e4e4e7;
          padding: 12px; font-size: 14px; }
  input:focus { outline: none; border-color: #3b82f6; }
  button { margin-top: 16px; width: 100%; padding: 12px; border: 0; border-radius: 10px; background: #3b82f6; color: #fff;
           font-weight: 800; letter-spacing: .15em; text-transform: uppercase; font-size: 11px; cursor: pointer; }
  .err { color: #f87171; font-size: 12px; margin: 12px 0 0; }
</style></head>
<body><form method="post" action="/api/auth/login">
  <h1>BÖRS</h1><p>Sign in to your portfolio</p>
  <label for="pw">Password</label>
  <input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
  <input type="hidden" name="next" value="${esc(next)}">
  <button type="submit">Sign in</button>
  ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ""}
</form></body></html>`;
}

/** Adds /login and /api/auth/*, and requires a session for everything else. No-op when disabled. */
export function registerAuth(app: Express): void {
  app.get("/api/auth/status", (req, res) => {
    res.json({ enabled: authEnabled(), signedIn: !authEnabled() || validSessionToken(readCookie(req, COOKIE)) });
  });
  if (!authEnabled()) return;

  // Behind Caddy: trust X-Forwarded-Proto so req.secure (and Secure cookies) work.
  app.set("trust proxy", "loopback");

  app.get("/login", (req, res) => {
    if (validSessionToken(readCookie(req, COOKIE))) return res.redirect(safeNext(req.query.next));
    res.type("html").send(loginPage(undefined, safeNext(req.query.next)));
  });

  app.post(
    "/api/auth/login",
    express.urlencoded({ extended: false, limit: "10kb" }),
    express.json({ limit: "10kb" }),
    (req, res) => {
    const ip = req.ip || "unknown";
    const body = (req.body ?? {}) as { password?: unknown; next?: unknown };
    const next = safeNext(body.next);
    const wantsJson = (req.headers["content-type"] ?? "").includes("application/json");
    if (tooManyFails(ip)) {
      const msg = "Too many attempts. Try again in 15 minutes.";
      return wantsJson ? res.status(429).json({ error: msg }) : res.status(429).type("html").send(loginPage(msg, next));
    }
    const ok =
      typeof body.password === "string" && verifyPassword(body.password, process.env.BORS_PASSWORD_HASH ?? "");
    if (!ok) {
      recordFail(ip);
      const msg = "Wrong password.";
      return wantsJson ? res.status(401).json({ error: msg }) : res.status(401).type("html").send(loginPage(msg, next));
    }
    fails.delete(ip);
    setSessionCookie(req, res, makeSessionToken(), SESSION_DAYS * 86_400);
    return wantsJson ? res.json({ ok: true }) : res.redirect(303, next);
  });

  app.post("/api/auth/logout", (req, res) => {
    setSessionCookie(req, res, "", 0);
    res.json({ ok: true });
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (validSessionToken(readCookie(req, COOKIE))) return next();
    if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Sign in required" });
    if (req.method !== "GET") return res.status(401).send("Sign in required");
    res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  });
}
