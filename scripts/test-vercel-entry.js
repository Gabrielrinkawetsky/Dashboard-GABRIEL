// Simula como a Vercel carrega a função: importa api/index.js (sem listen) e atende pedidos HTTP com o app exportado.
// Roda numa pasta temporária com banco próprio. Não substitui o teste na Vercel real (o banco remoto Turso não é exercitado aqui).
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const initial = process.cwd();
const dir = mkdtempSync(path.join(tmpdir(), "dashboard-vercel-test-"));
process.chdir(dir);
Object.assign(process.env, { VERCEL: "1", NODE_ENV: "production", WEBHOOK_SECRET: "test-only-webhook-secret-0123456789" });
delete process.env.TURSO_DATABASE_URL;
const alias = process.argv[2] === "alias"; // alias: o nome usado no guia VERCEL.md
process.env[alias ? "ADMIN_PASSWORD" : "ADMIN_INITIAL_PASSWORD"] = "senha-inicial-de-teste-123"; // cria o administrador na primeira execução
process.env.ALLOW_LOCAL_DB = "1"; // o teste usa um banco local temporário; sem isso o servidor recusa subir na Vercel sem o Turso

const { default: handler } = await import(new URL("../api/index.js", import.meta.url).href);
assert.equal(typeof handler, "function", "api/index.js deve exportar uma função (req, res)");
const server = http.createServer(handler);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const session = await fetch(base + "/api/session");
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), { authenticated: false });
  assert.match(session.headers.get("strict-transport-security") ?? "", /max-age/);
  assert.equal((await fetch(base + "/api/data")).status, 401, "API privada sem login");
  assert.equal((await fetch(base + "/api/nao-existe")).status, 401, "rota inexistente também exige login");
  assert.equal((await fetch(base + "/api/webhooks/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401, "webhook sem segredo");
  const post = (body) => fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const ok = await post({ username: "gabriel", password: "senha-inicial-de-teste-123" });
  assert.equal(ok.status, 200, "o administrador criado por ADMIN_INITIAL_PASSWORD deve conseguir entrar");
  assert.match(ok.headers.get("set-cookie") ?? "", /HttpOnly.*Secure|Secure.*HttpOnly/);
  assert.equal((await post({ username: "gabriel", password: "senha-errada-qualquer-123" })).status, 401, "senha errada");
  console.log("PASS: a função da Vercel (api/index.js) carrega, responde e protege as rotas privadas.");
} finally {
  server.close();
  const { db } = await import(new URL("../server/db.js", import.meta.url).href);
  await db.close();
  process.chdir(initial);
  if (!path.basename(dir).startsWith("dashboard-vercel-test-")) throw new Error("caminho inesperado na limpeza");
  // No Windows o arquivo do banco só é liberado quando este processo termina: a pasta temporária é apagada por um
  // processo separado, logo depois que este sai.
  spawn(process.execPath, ["-e", "setTimeout(() => require('fs').rmSync(process.argv[1], { recursive: true, force: true, maxRetries: 20, retryDelay: 300 }), 1500)", dir], { detached: true, stdio: "ignore" }).unref();
}
