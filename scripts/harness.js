// Utilitário dos testes de API: sobe o servidor numa pasta temporária com banco próprio (não toca em data/ nem no .env),
// cria um usuário de teste e devolve um cliente HTTP já autenticado.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function startHarness(prefix = "dashboard-test-") {
  const initial = process.cwd();
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  process.chdir(dir);
  process.env.WEBHOOK_SECRET = "test-only-webhook-secret-0123456789";
  const { db } = await import(new URL("../server/db.js", import.meta.url).href);
  const { hashPassword } = await import(new URL("../server/auth.js", import.meta.url).href);
  const PASSWORD = "test-only-password-123456";
  await db.prepare("INSERT INTO auth_users(username,password_hash) VALUES (?,?)").run("tester", await hashPassword(PASSWORD));

  const children = [];
  const startServer = async (env = {}) => {
    const port = 23000 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(project, "server/index.js")], {
      cwd: dir, env: { ...process.env, PORT: String(port), NODE_ENV: "test", ...env }, stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error("servidor não iniciou")), 15000);
      child.stdout.on("data", (d) => { if (String(d).includes("API em")) { clearTimeout(to); resolve(); } });
      child.once("exit", (c) => { clearTimeout(to); reject(new Error("servidor saiu: " + c)); });
    });
    return { base: `http://localhost:${port}`, port };
  };

  const srv = await startServer();
  let cookie = "";
  /** api(rota, método, corpo, { cookie, origin, headers, raw, base }) → { status, json, text, headers } */
  async function api(route, method = "GET", body, opt = {}) {
    if (method !== "GET" && method !== "OPTIONS" && body === undefined) body = {};
    const headers = { ...(body !== undefined && !opt.raw ? { "Content-Type": "application/json" } : {}), ...(opt.headers ?? {}) };
    if (opt.cookie !== null) headers.Cookie = opt.cookie ?? cookie;
    if (opt.origin) headers.Origin = opt.origin;
    const res = await fetch((opt.base ?? srv.base) + "/api/" + route, { method, headers, body: body === undefined || method === "GET" ? undefined : opt.raw ? body : JSON.stringify(body) });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: res.status, json, text, headers: res.headers };
  }
  const login = await api("login", "POST", { username: "tester", password: PASSWORD }, { cookie: null });
  if (login.status !== 200) throw new Error("login de teste falhou: " + login.status);
  cookie = login.headers.get("set-cookie").split(";")[0];

  const results = [];
  const t = async (id, name, fn) => {
    try { await fn(); results.push([id, name, true]); console.log(`PASS ${id} ${name}`); }
    catch (e) { results.push([id, name, false]); console.log(`FAIL ${id} ${name}\n       -> ${String(e.message).split("\n")[0]}`); }
  };
  const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg ?? "esperado"}: obtido ${JSON.stringify(a)}, esperado ${JSON.stringify(b)}`); };
  const ok = (v, msg) => { if (!v) throw new Error(msg ?? "condição falsa"); };

  async function finish() {
    for (const c of children) c.kill();
    await new Promise((r) => setTimeout(r, 300));
    await db.close();
    process.chdir(initial);
    if (!path.basename(dir).startsWith(prefix)) throw new Error("caminho inesperado na limpeza");
    // No Windows o arquivo do banco só é liberado quando este processo termina: a pasta é apagada por um processo separado.
    spawn(process.execPath, ["-e", "setTimeout(() => require('fs').rmSync(process.argv[1], { recursive: true, force: true, maxRetries: 20, retryDelay: 300 }), 1500)", dir], { detached: true, stdio: "ignore" }).unref();
    const failed = results.filter((r) => !r[2]);
    console.log(`\n${results.length - failed.length}/${results.length} verificações passaram.`);
    if (failed.length) { console.log("FALHARAM: " + failed.map((f) => f[0]).join(", ")); process.exit(1); }
    process.exit(0);
  }

  return { api, t, eq, ok, finish, startServer, base: srv.base, db, getCookie: () => cookie };
}
