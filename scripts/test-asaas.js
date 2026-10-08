// Integração com o Asaas contra um Asaas FALSO local (nada sai para a internet).
// Isolado: roda o servidor numa pasta temporária com banco próprio. Uso: npm run test:asaas
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const initial = process.cwd();
const testDir = mkdtempSync(path.join(tmpdir(), "dashboard-asaas-test-"));
process.chdir(testDir);
const KEY = "$aact_hmlg_test_only_key", HOOK = "test-only-asaas-webhook-token-0123456789";

// ---------- Asaas falso ----------
const fake = { customers: [], payments: new Map(), calls: [], down: false };
const asaas = http.createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  const send = (code, json) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(json)); };
  fake.calls.push(`${req.method} ${req.url}`);
  if (fake.down) return send(500, {});
  if (req.headers.access_token !== KEY) return send(401, {});
  const url = new URL(req.url, "http://x");
  if (req.method === "GET" && url.pathname === "/customers") return send(200, { data: fake.customers.filter((c) => c.externalReference === url.searchParams.get("externalReference")) });
  if (req.method === "POST" && url.pathname === "/customers") { const c = { id: `cus_${fake.customers.length + 1}`, ...JSON.parse(body) }; fake.customers.push(c); return send(200, c); }
  if (req.method === "POST" && url.pathname === "/payments") {
    await new Promise((r) => setTimeout(r, 50)); // deixa duas requisições simultâneas se cruzarem
    const b = JSON.parse(body); const id = `pay_${fake.payments.size + 1}`;
    const p = { id, ...b, status: "PENDING", invoiceUrl: `https://sandbox.asaas.com/i/${id}`, deleted: false };
    fake.payments.set(id, p); return send(200, p);
  }
  const m = /^\/payments\/([\w-]+)$/.exec(url.pathname);
  if (m && fake.payments.has(m[1])) {
    if (req.method === "GET") return send(200, fake.payments.get(m[1]));
    if (req.method === "DELETE") { fake.payments.get(m[1]).deleted = true; return send(200, { deleted: true, id: m[1] }); }
  }
  send(404, { errors: [{ description: "não encontrado" }] });
});
await new Promise((r) => asaas.listen(0, "127.0.0.1", r));

// ---------- Painel ----------
process.env.WEBHOOK_SECRET = "test-only-webhook-secret";
const { db } = await import("../server/db.js");
const { hashPassword } = await import("../server/auth.js");
const { today } = await import("../server/dates.js");
const PASSWORD = "test-only-password-123456";
await db.prepare("INSERT INTO auth_users(username,password_hash) VALUES (?,?)").run("tester", await hashPassword(PASSWORD));
const port = 26000 + Math.floor(Math.random() * 5000), base = `http://localhost:${port}`;
const child = spawn(process.execPath, [path.join(project, "server/index.js")], {
  cwd: testDir, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PORT: String(port), NODE_ENV: "test", ASAAS_API_KEY: KEY, ASAAS_WEBHOOK_TOKEN: HOOK, ASAAS_API_URL: `http://127.0.0.1:${asaas.address().port}` },
});
let cookie = "";
const api = async (route, method = "GET", body) => {
  const r = await fetch(`${base}/api/${route}`, { method, headers: { "Content-Type": "application/json", Cookie: cookie }, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
  const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const hook = (event, payment, token = HOOK) => fetch(`${base}/api/webhooks/asaas`, {
  method: "POST", headers: { "Content-Type": "application/json", ...(token ? { "asaas-access-token": token } : {}) }, body: JSON.stringify({ id: `evt_${Math.random()}`, event, payment }),
}).then(async (r) => ({ status: r.status, json: await r.json() }));
const data = async () => (await api("data")).json;
const paysOf = async (inst) => (await data()).payments.filter((p) => p.installment_id === inst);

const results = [];
const t = async (name, fn) => {
  try { await fn(); results.push(true); console.log(`PASS ${name}`); }
  catch (e) { results.push(false); console.log(`FAIL ${name}\n     ${e.message}`); }
};

try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server startup timeout")), 15000);
    child.stdout.on("data", (d) => { if (String(d).includes("API em")) { clearTimeout(timeout); resolve(); } });
    child.once("exit", (code) => { clearTimeout(timeout); reject(new Error("Server stopped: " + code)); });
  });
  assert.equal((await api("login", "POST", { username: "tester", password: PASSWORD })).status, 200);
  const client = (await api("clients", "POST", { name: "Ana Souza", company: "Ana Doces", email: "ana@exemplo.com", phone: "(11) 98888-7777" })).json.id;
  const inst = async (amount, due = "2020-01-10") => { await api("installments", "POST", { client_id: client, amount, due_date: due, label: `Teste ${amount}` }); return (await data()).installments.find((i) => i.amount === amount).id; };
  const i1 = await inst(150000), i2 = await inst(80000, "2099-05-01"), i3 = await inst(50000);

  await t("informa que o Asaas está conectado (sandbox) em /api/data", async () => {
    assert.deepEqual((await data()).integration.asaas, { configured: true, env: "sandbox", webhook: true });
  });
  await t("sem CPF/CNPJ não cria cobrança, com mensagem clara", async () => {
    const r = await api(`installments/${i1}/asaas`, "POST");
    assert.equal(r.status, 400); assert.match(r.json.error, /CPF ou CNPJ/);
    assert.equal((await data()).installments.find((i) => i.id === i1).asaas_payment_id, null, "parcela continua livre");
  });
  await t("CPF inválido é recusado; válido é guardado só com números", async () => {
    assert.equal((await api(`clients/${client}`, "PATCH", { cpf_cnpj: "111.111.111-11" })).status, 400);
    assert.equal((await api(`clients/${client}`, "PATCH", { cpf_cnpj: "529.982.247-25" })).status, 200);
    assert.equal((await data()).clients[0].cpf_cnpj, "52998224725");
  });
  await t("cria cliente e cobrança no Asaas com o saldo, vencimento não passado e referência da parcela", async () => {
    await api("payments", "POST", { installment_id: i1, amount: 50000 }); // parte já paga à mão
    const r = await api(`installments/${i1}/asaas`, "POST");
    assert.equal(r.status, 200); assert.match(r.json.invoiceUrl, /^https:\/\/sandbox\.asaas\.com\/i\//);
    const p = [...fake.payments.values()][0];
    assert.equal(p.value, 1000); assert.equal(p.billingType, "UNDEFINED"); assert.equal(p.externalReference, `parcela-${i1}`);
    assert.equal(p.dueDate, today(), "vencimento vencido vira hoje");
    assert.equal(fake.customers.length, 1); assert.equal(fake.customers[0].cpfCnpj, "52998224725"); assert.equal(fake.customers[0].mobilePhone, "11988887777");
    const row = (await data()).installments.find((i) => i.id === i1);
    assert.equal(row.asaas_payment_id, p.id); assert.equal(row.asaas_status, "PENDING");
  });
  await t("duplo clique: duas requisições simultâneas criam UMA cobrança e reaproveitam o cliente", async () => {
    const before = fake.payments.size;
    const rs = await Promise.all([api(`installments/${i2}/asaas`, "POST"), api(`installments/${i2}/asaas`, "POST")]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
    assert.equal(fake.payments.size, before + 1); assert.equal(fake.customers.length, 1);
    assert.equal(fake.payments.get(`pay_${before + 1}`).dueDate, "2099-05-01", "mantém vencimento futuro");
  });
  await t("webhook sem token ou com token errado é recusado e não grava nada", async () => {
    assert.equal((await hook("PAYMENT_RECEIVED", { id: "pay_1" }, null)).status, 401);
    assert.equal((await hook("PAYMENT_RECEIVED", { id: "pay_1" }, "x".repeat(40))).status, 401);
    assert.equal((await paysOf(i1)).length, 1);
  });
  await t("pagamento confirmado: valor e status vêm da API do Asaas, não do corpo do evento", async () => {
    Object.assign(fake.payments.get("pay_1"), { status: "CONFIRMED", value: 1012.5, confirmedDate: "2026-10-01", billingType: "CREDIT_CARD" });
    const r = await hook("PAYMENT_CONFIRMED", { id: "pay_1", value: 1, status: "RECEIVED" });
    assert.equal(r.status, 200); assert.equal(r.json.result, "pagamento registrado");
    const p = (await paysOf(i1)).find((x) => x.source === "asaas");
    assert.equal(p.amount, 101250); assert.equal(p.paid_at, "2026-10-01"); assert.equal(p.external_id, "pay_1");
  });
  await t("evento repetido, RECEIVED depois de CONFIRMED e botão atualizar não duplicam o pagamento", async () => {
    await hook("PAYMENT_CONFIRMED", { id: "pay_1" });
    fake.payments.get("pay_1").status = "RECEIVED";
    await hook("PAYMENT_RECEIVED", { id: "pay_1" });
    assert.equal((await api(`installments/${i1}/asaas/sync`, "POST")).status, 200);
    assert.equal((await paysOf(i1)).filter((p) => p.source === "asaas").length, 1);
    assert.equal((await data()).installments.find((i) => i.id === i1).asaas_status, "RECEIVED");
  });
  await t("cobrança paga não pode ser cancelada pelo painel", async () => {
    const r = await api(`installments/${i1}/asaas`, "DELETE"); assert.equal(r.status, 409);
  });
  await t("estorno no Asaas vira um estorno no painel, uma vez só", async () => {
    fake.payments.get("pay_1").status = "REFUNDED";
    assert.equal((await hook("PAYMENT_REFUNDED", { id: "pay_1" })).json.result, "estorno registrado");
    await hook("PAYMENT_REFUNDED", { id: "pay_1" });
    const refunds = (await paysOf(i1)).filter((p) => p.type === "refund");
    assert.equal(refunds.length, 1); assert.equal(refunds[0].amount, 101250);
  });
  await t("eventos que não interessam respondem 200 (não interrompem a fila do Asaas)", async () => {
    const other = { id: "pay_x", externalReference: null }; fake.payments.set("pay_x", { id: "pay_x", status: "RECEIVED", value: 10 });
    assert.equal((await hook("PAYMENT_RECEIVED", other)).json.result, "ignorado: cobrança não criada pelo painel");
    assert.equal((await hook("SUBSCRIPTION_CREATED", { id: "sub_1" })).status, 200);
    assert.equal((await hook("PAYMENT_CREATED", { id: "../../x" })).status, 200);
  });
  await t("Asaas fora do ar: webhook responde 500 para o Asaas tentar de novo", async () => {
    fake.down = true; const r = await hook("PAYMENT_RECEIVED", { id: "pay_1" }); fake.down = false;
    assert.equal(r.status, 500);
  });
  await t("cancelar cobrança aberta exclui no Asaas e libera a parcela para nova cobrança", async () => {
    const id = (await data()).installments.find((i) => i.id === i2).asaas_payment_id;
    assert.equal((await api(`installments/${i2}/asaas`, "DELETE")).status, 200);
    assert.equal(fake.payments.get(id).deleted, true);
    assert.equal((await data()).installments.find((i) => i.id === i2).asaas_payment_id, null);
    assert.equal((await api(`installments/${i2}/asaas`, "POST")).status, 200);
  });
  await t("cobrança excluída direto no Asaas (evento) também libera a parcela", async () => {
    await api(`installments/${i3}/asaas`, "POST");
    const id = (await data()).installments.find((i) => i.id === i3).asaas_payment_id;
    assert.equal((await hook("PAYMENT_DELETED", { id, externalReference: `parcela-${i3}` })).status, 200);
    assert.equal((await data()).installments.find((i) => i.id === i3).asaas_payment_id, null);
  });
  await t("rotas da cobrança exigem login", async () => {
    const saved = cookie; cookie = "";
    for (const [r, m] of [[`installments/${i3}/asaas`, "POST"], [`installments/${i3}/asaas/sync`, "POST"], [`installments/${i3}/asaas`, "DELETE"]]) assert.equal((await api(r, m)).status, 401);
    cookie = saved;
  });
} finally {
  child.kill(); await new Promise((r) => (child.exitCode !== null ? r() : child.once("exit", r)));
  asaas.close(); db.close(); process.chdir(initial);
  if (path.dirname(testDir) !== path.resolve(tmpdir()) || !path.basename(testDir).startsWith("dashboard-asaas-test-")) throw new Error("Unexpected cleanup path");
  rmSync(testDir, { recursive: true, force: true });
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} verificações passaram.`);
if (passed !== results.length) process.exitCode = 1;
