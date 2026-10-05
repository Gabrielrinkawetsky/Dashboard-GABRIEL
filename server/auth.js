import crypto from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

// Gera ADMIN_PASSWORD, SESSION_SECRET e WEBHOOK_SECRET no primeiro uso e grava no .env (fora do git).
const envFile = ".env";
const current = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
export let generatedPassword = null;
for (const key of ["ADMIN_PASSWORD", "SESSION_SECRET", "WEBHOOK_SECRET"]) {
  if (process.env[key] || new RegExp(`^${key}=`, "m").test(current)) {
    if (!process.env[key]) process.env[key] = current.match(new RegExp(`^${key}=(.*)$`, "m"))[1].trim();
    continue;
  }
  const v = key === "ADMIN_PASSWORD" ? crypto.randomBytes(9).toString("base64url") : crypto.randomBytes(32).toString("hex");
  appendFileSync(envFile, `${key}=${v}\n`);
  process.env[key] = v;
  if (key === "ADMIN_PASSWORD") generatedPassword = v;
}

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
export const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const sign = (p) => crypto.createHmac("sha256", process.env.SESSION_SECRET).update(p).digest("base64url");

export const makeToken = () => {
  const p = Buffer.from(JSON.stringify({ exp: Date.now() + 7 * 864e5 })).toString("base64url");
  return `${p}.${sign(p)}`;
};
export const validToken = (t) => {
  if (!t) return false;
  const [p, s] = t.split(".");
  if (!p || !s || !safeEqual(sign(p), s)) return false;
  try { return JSON.parse(Buffer.from(p, "base64url").toString()).exp > Date.now(); } catch { return false; }
};
export const readCookie = (req, name) =>
  (req.headers.cookie ?? "").split(";").map((c) => c.trim().split("=")).find(([k]) => k === name)?.[1];

const attempts = new Map();
export const loginAllowed = (ip) => {
  const now = Date.now();
  const list = (attempts.get(ip) ?? []).filter((t) => now - t < 60_000);
  attempts.set(ip, list);
  return list.length < 5;
};
export const noteAttempt = (ip) => attempts.set(ip, [...(attempts.get(ip) ?? []), Date.now()]);
