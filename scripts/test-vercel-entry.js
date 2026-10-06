// Simula como a Vercel carrega a função: importa api/index.js (sem listen) e atende pedidos HTTP com o app exportado.
// Roda numa pasta temporária com banco próprio. Não substitui o teste na Vercel real (o banco remoto Turso não é exercitado aqui).
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const initial = process.cwd();
const dir = mkdtempSync(path.join(tmpdir(), "dashboard-vercel-test-"));
process.chdir(dir);
Object.assign(process.env, { VERCEL: "1", NODE_ENV: "production", WEBHOOK_SECRET: "test-only-webhook-secret-0123456789" });
delete process.env.TURSO_DATABASE_URL;

const { default: handler } = await import(pathToFileURL(path.join(project, "api/index.js")).href);
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
  console.log("PASS: a função da Vercel (api/index.js) carrega, responde e protege as rotas privadas.");
} finally {
  server.close();
  const { db } = await import(pathToFileURL(path.join(project, "server/db.js")).href);
  await db.close();
  process.chdir(initial);
  if (!path.basename(dir).startsWith("dashboard-vercel-test-")) throw new Error("caminho inesperado na limpeza");
  rmSync(dir, { recursive: true, force: true });
}
