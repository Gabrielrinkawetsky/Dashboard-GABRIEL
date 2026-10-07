// Na Vercel SEM banco utilizável o servidor não pode cair: precisa subir e responder com a causa (503 + mensagem).
//   node scripts/test-vercel-nodb.js            → TURSO_DATABASE_URL ausente
//   node scripts/test-vercel-nodb.js bad-url    → endereço do Turso inválido (credenciais erradas)
import assert from "node:assert/strict";
import http from "node:http";

const mode = process.argv[2] ?? "missing";
Object.assign(process.env, { VERCEL: "1", NODE_ENV: "production" });
for (const k of ["WEBHOOK_SECRET", "TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "ALLOW_LOCAL_DB", "ADMIN_INITIAL_PASSWORD", "ADMIN_PASSWORD"]) delete process.env[k];
if (mode === "bad-url") Object.assign(process.env, { TURSO_DATABASE_URL: "libsql://nao-existe-teste.invalid", TURSO_AUTH_TOKEN: "token-falso" });

const { default: handler } = await import(new URL("../api/index.js", import.meta.url).href);
assert.equal(typeof handler, "function");
const server = http.createServer(handler);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const json = (path, init) => fetch(base + path, init).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null), headers: r.headers }));
try {
  const health = await json("/api/health");
  assert.equal(health.status, 503, "health sem banco");
  assert.equal(health.body.database, false);
  assert.ok(typeof health.body.reason === "string" && health.body.reason.length > 20, "health deve explicar a causa");
  assert.equal(Object.keys(health.body).sort().join(), "database,ok,reason", "health não pode expor mais nada");

  const session = await json("/api/session");
  assert.equal(session.status, 200, "a tela precisa conseguir perguntar se há sessão");
  assert.deepEqual(session.body, { authenticated: false });

  const login = await json("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "qualquer-senha-123" }) });
  assert.equal(login.status, 503, "login sem banco deve explicar, não dar erro genérico");
  assert.match(login.body.error, mode === "bad-url" ? /conectar ao banco|preparar o banco/i : /Turso/);
  assert.equal(login.headers.get("set-cookie"), null, "não pode criar sessão");

  assert.equal((await json("/api/data")).status, 503);
  const hook = await json("/api/webhooks/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(hook.status, 503, "webhook indisponível sem banco");
  console.log(`PASS (${mode}): sem banco utilizável o servidor sobe e responde 503 com a causa, sem sessão e sem vazar detalhes.`);
} finally {
  server.close();
}
process.exit(0);
