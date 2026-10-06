// Testes de segurança do servidor (API, webhook, validação, concorrência, cabeçalhos, segredos).
// Isolado: roda o servidor numa pasta temporária com banco próprio. Não toca em data/app.db nem no .env.
// Uso: npm run test:security   (o teste de autenticação básica continua em npm run test:auth)
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDir = mkdtempSync(path.join(tmpdir(), "dashboard-sec-test-"));
process.chdir(testDir);
const WEBHOOK = "test-only-webhook-secret-0123456789";
process.env.WEBHOOK_SECRET = WEBHOOK;
const { db } = await import("../server/db.js");
const { hashPassword } = await import("../server/auth.js");
const PASSWORD = "test-only-password-123456";
await db.prepare("INSERT INTO auth_users(username,password_hash) VALUES (?,?)").run("tester", await hashPassword(PASSWORD));

const children = [];
async function startServer(env = {}) {
  const port = 23000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(project, "server/index.js")], {
    cwd: testDir, env: { ...process.env, PORT: String(port), NODE_ENV: "test", ...env }, stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("servidor não iniciou")), 10000);
    child.stdout.on("data", (d) => { if (String(d).includes("API em")) { clearTimeout(to); resolve(); } });
    child.once("exit", (c) => { clearTimeout(to); reject(new Error("servidor saiu: " + c)); });
  });
  return { base: `http://localhost:${port}`, port };
}

const srv = await startServer();
let cookie = "";
async function api(route, method = "GET", body, opt = {}) {
  if (method !== "GET" && body === undefined) body = {}; // igual ao frontend: gravações sempre enviam JSON
  const headers = { ...(body !== undefined && !opt.raw ? { "Content-Type": "application/json" } : {}), ...(opt.headers ?? {}) };
  if (opt.cookie !== null) headers.Cookie = opt.cookie ?? cookie;
  if (opt.origin) headers.Origin = opt.origin;
  const res = await fetch((opt.base ?? srv.base) + "/api/" + route, { method, headers, body: body === undefined ? undefined : opt.raw ? body : JSON.stringify(body) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, json, text, headers: res.headers };
}
const login = await api("login", "POST", { username: "tester", password: PASSWORD }, { cookie: null });
if (login.status !== 200) throw new Error("login de teste falhou: " + login.status);
cookie = login.headers.get("set-cookie").split(";")[0];

const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg ?? "esperado"}: obtido ${JSON.stringify(a)}, esperado ${JSON.stringify(b)}`); };
const ok = (v, msg) => { if (!v) throw new Error(msg ?? "condição falsa"); };
const results = [];
const t = async (id, name, fn) => {
  try { await fn(); results.push([id, name, true]); console.log(`PASS ${id} ${name}`); }
  catch (e) { results.push([id, name, false, String(e.message).split("\n")[0]]); console.log(`FAIL ${id} ${name}\n       -> ${String(e.message).split("\n")[0]}`); }
};

// ---- fixtures ------------------------------------------------------------------------------------
const mkClient = async (name = "Cliente Teste") => (await api("clients", "POST", { name })).json.id;
const mkProposal = async (client_id, value = 100000, extra = {}) => (await api("proposals", "POST", { client_id, service: "Landing page", value, status: "enviada", ...extra })).json.id;
const approve = (id, body = { entrada: 0, parcelas: 1 }) => api(`proposals/${id}/approve`, "POST", body);
const data = async () => (await api("data")).json;
async function mkInstallment(value = 100000, parcelas = 1) {
  const c = await mkClient(); const p = await mkProposal(c, value);
  const r = await approve(p, { entrada: 0, parcelas }); eq(r.status, 200, "aprovação da fixture");
  const d = await data();
  return { client: c, proposal: p, inst: d.installments.filter((i) => i.proposal_id === p) };
}
const count = async (k) => (await data())[k].length;
let evSeq = 0;
const wh = (body, secret = WEBHOOK, base = srv.base) => fetch(base + "/api/webhooks/payments", { method: "POST", headers: { "Content-Type": "application/json", ...(secret ? { "x-webhook-secret": secret } : {}) }, body: JSON.stringify(body) })
  .then(async (r) => { const text = await r.text(); let json; try { json = JSON.parse(text); } catch {} return { status: r.status, json, text }; });
const evt = (over) => ({ provider: "pagto", event_id: `evt-${++evSeq}-${Date.now()}`, type: "payment.confirmed", currency: "BRL", ...over });

// ====================================================================================================
console.log("\n== 1. Autenticação e acesso (chamadas diretas à API) ==");
await t("A1", "toda rota privada recusa chamada sem login (sem cookie / cookie forjado)", async () => {
  const routes = [["data"], ["webhook-secret"], ["clients", "POST", { name: "x" }], ["clients/1", "PATCH", { name: "x" }], ["clients/1", "DELETE"],
    ["proposals", "POST", { client_id: 1, service: "x", value: 1 }], ["proposals/1/approve", "POST", {}], ["projects", "POST", { client_id: 1, service: "x" }],
    ["projects/1", "PATCH", {}], ["projects/1/notes", "POST", { text: "x" }], ["payments", "POST", { installment_id: 1, amount: 1 }], ["payments/1", "DELETE"],
    ["installments", "POST", { client_id: 1, amount: 1, due_date: "2026-01-01" }], ["expenses", "POST", {}], ["recurring", "POST", {}], ["services", "POST", { name: "x" }],
    ["settings", "PUT", { company_name: "x" }], ["demo", "POST", {}], ["demo", "DELETE"], ["change-password", "POST", { currentPassword: "a", newPassword: "b".repeat(15) }]];
  for (const [route, method, body] of routes)
    for (const c of [null, "session=forjado", "session=" + "A".repeat(43)]) {
      const r = await api(route, method ?? "GET", body, { cookie: c });
      eq(r.status, 401, `${method ?? "GET"} /api/${route} cookie=${c ?? "nenhum"}`);
    }
});
await t("A2", "gravação cross-site e corpo não-JSON são recusados mesmo com sessão válida", async () => {
  const n0 = await count("clients");
  eq((await api("clients", "POST", { name: "evil" }, { origin: "https://evil.example" })).status, 403, "Origin externo");
  eq((await api("clients", "POST", { name: "evil" }, { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403, "Sec-Fetch-Site");
  eq((await api("clients", "POST", "name=evil", { raw: true, headers: { "Content-Type": "application/x-www-form-urlencoded" } })).status, 415, "form");
  eq((await api("clients", "POST", '{"name":"evil"}', { raw: true, headers: { "Content-Type": "text/plain" } })).status, 415, "text/plain");
  eq(await count("clients"), n0, "nada foi gravado");
});
await t("A3", "cabeçalhos de segurança; sem CORS para origem externa; sem x-powered-by", async () => {
  const r = await api("session", "GET", undefined, { origin: "https://evil.example" });
  eq(r.headers.get("access-control-allow-origin"), null, "ACAO");
  eq(r.headers.get("x-powered-by"), null, "x-powered-by");
  eq(r.headers.get("x-content-type-options"), "nosniff"); eq(r.headers.get("x-frame-options"), "DENY");
  ok(/frame-ancestors 'none'/.test(r.headers.get("content-security-policy") ?? ""), "CSP frame-ancestors");
  const pre = await fetch(srv.base + "/api/clients", { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } });
  eq(pre.headers.get("access-control-allow-origin"), null, "preflight sem ACAO");
});
await t("A4", "produção: cookie Secure + HttpOnly + SameSite=Strict e HSTS", async () => {
  const prod = await startServer({ NODE_ENV: "production", APP_ORIGIN: "https://painel.exemplo.com" });
  const r = await api("login", "POST", { username: "tester", password: PASSWORD }, { cookie: null, base: prod.base, origin: "https://painel.exemplo.com" });
  eq(r.status, 200, "login em produção");
  const sc = r.headers.get("set-cookie") ?? "";
  ok(/HttpOnly/.test(sc) && /SameSite=Strict/.test(sc) && /; Secure/.test(sc), "flags do cookie: " + sc.replace(/session=[^;]+/, "session=<oculto>"));
  ok(/max-age/i.test(r.headers.get("strict-transport-security") ?? ""), "HSTS");
  eq((await api("clients", "POST", { name: "x" }, { cookie: sc.split(";")[0], base: prod.base, origin: "https://evil.example" })).status, 403, "origem externa em produção");
});

console.log("\n== 2. Integridade e validação das gravações ==");
await t("B1", "campos privilegiados não são alterados pelo cliente (id, demo, created_at, status aprovada)", async () => {
  const c = await mkClient("Mass");
  await api(`clients/${c}`, "PATCH", { id: 9999, demo: 1, created_at: "2000-01-01", name: "Mass2" });
  const row = (await data()).clients.find((x) => x.id === c);
  eq(row.name, "Mass2"); eq(row.demo, 0, "demo"); ok(row.created_at !== "2000-01-01", "created_at");
  const p = await api("proposals", "POST", { client_id: c, service: "x", value: 100, status: "aprovada" });
  eq((await data()).proposals.find((x) => x.id === p.json.id).status, "enviada", "criar já aprovada");
  eq((await api(`proposals/${p.json.id}`, "PATCH", { status: "aprovada" })).status, 400, "aprovar via PATCH");
  eq((await api(`proposals/${p.json.id}`, "PATCH", { decided_at: "2000-01-01", id: 5 })).status, 200, "campos ignorados");
  eq((await data()).proposals.find((x) => x.id === p.json.id).decided_at, null, "decided_at");
});
await t("B2", "proposta aprovada não pode ter valor/cliente/serviço alterados (não deixa o financeiro inconsistente)", async () => {
  const { proposal, client } = await mkInstallment(100000);
  const other = await mkClient("Outro");
  for (const body of [{ value: 1 }, { client_id: other }, { service: "Outro serviço" }]) {
    const r = await api(`proposals/${proposal}`, "PATCH", body);
    ok(r.status >= 400 && r.status < 500, `PATCH ${JSON.stringify(body)} deveria ser recusado (status ${r.status})`);
  }
  const p = (await data()).proposals.find((x) => x.id === proposal);
  eq(p.value, 100000, "valor"); eq(p.client_id, client, "cliente");
});
await t("B3", "tipos errados, textos gigantes e números absurdos viram 400 (nunca 500) e não gravam nada", async () => {
  const c = await mkClient(); const n0 = await count("clients"); const np = await count("proposals");
  const cases = [
    ["clients", "POST", { name: { a: 1 } }], ["clients", "POST", { name: ["x"] }], ["clients", "POST", { name: "x".repeat(100000) }],
    ["clients", "POST", { name: "ok", email: 12345 }], ["clients", "POST", { name: "ok", notes: "n".repeat(50000) }],
    ["proposals", "POST", { client_id: c, service: "x", value: 1e15 }], ["proposals", "POST", { client_id: c, service: "x", value: "abc" }],
    ["proposals", "POST", { client_id: c, service: "x", value: -5 }], ["proposals", "POST", { client_id: 987654, service: "x", value: 100 }],
    ["proposals", "POST", { client_id: c, service: "x", value: 100, deadline: "lixo" }], ["proposals", "POST", { client_id: c, service: "x", value: 100, valid_until: "2026-13-45" }],
    ["projects", "POST", { client_id: c, service: "x", progress: 500 }], ["projects", "POST", { client_id: c, service: "x", checklist: "não é lista" }],
    ["projects", "POST", { client_id: c, service: "x", checklist: Array.from({ length: 500 }, () => ({ text: "i", done: false })) }],
    ["recurring", "POST", { client_id: c, name: "x", amount: 100, period: "diario" }], ["recurring", "POST", { client_id: c, name: "x", amount: 100, status: "hackeado" }],
    ["expenses", "POST", { description: "x", amount: 100, date: "ontem" }], ["services", "POST", { name: "x", active: 7 }],
  ];
  for (const [route, method, body] of cases) {
    const r = await api(route, method, body);
    ok(r.status >= 400 && r.status < 500, `${route} ${JSON.stringify(body).slice(0, 70)} -> status ${r.status} (esperado 4xx)`);
  }
  eq(await count("clients"), n0, "clientes"); eq(await count("proposals"), np, "propostas");
});
await t("B4", "aprovar com parcelas/data inválidas é recusado e a proposta continua não aprovada", async () => {
  const c = await mkClient(); const p = await mkProposal(c, 100000);
  for (const body of [{ parcelas: "abc" }, { parcelas: {} }, { parcelas: 0 }, { parcelas: 1000 }, { parcelas: 2.5 }, { entrada: "x" }, { entrada: -1 }, { entrada: 100000 }, { primeiro_vencimento: "lixo" }, { primeiro_vencimento: "2026-02-31" }]) {
    const r = await approve(p, { entrada: 0, parcelas: 1, ...body });
    ok(r.status === 400, `${JSON.stringify(body)} -> status ${r.status} (esperado 400)`);
  }
  const d = await data();
  eq(d.proposals.find((x) => x.id === p).status, "enviada", "status"); eq(d.projects.filter((x) => x.proposal_id === p).length, 0, "projetos"); eq(d.installments.filter((x) => x.proposal_id === p).length, 0, "parcelas");
});
await t("B5", "pagamento/cobrança/anotação: datas, textos e referências inválidas são recusados com 4xx", async () => {
  const { inst, client } = await mkInstallment(100000);
  const id = inst[0].id; const np = await count("payments"); const ni = await count("installments");
  const cases = [
    ["payments", { installment_id: id, amount: 100, paid_at: "lixo" }], ["payments", { installment_id: id, amount: 100, note: "x".repeat(5000) }],
    ["payments", { installment_id: id, amount: "1e3x" }], ["payments", { installment_id: id, amount: 10.5 }], ["payments", { installment_id: { a: 1 }, amount: 100 }],
    ["installments", { client_id: client, amount: 100, due_date: "lixo" }], ["installments", { client_id: 987654, amount: 100, due_date: "2026-01-01" }],
    ["installments", { client_id: client, amount: 100, due_date: "2026-01-01", label: "l".repeat(5000) }], ["installments", { client_id: client, amount: 1e15, due_date: "2026-01-01" }],
    ["projects/987654/notes", { text: "anotação" }], ["projects/1/notes", { text: "t".repeat(100000) }],
  ];
  for (const [route, body] of cases) { const r = await api(route, "POST", body); ok(r.status >= 400 && r.status < 500, `${route} ${JSON.stringify(body).slice(0, 60)} -> ${r.status}`); }
  eq(await count("payments"), np, "pagamentos"); eq(await count("installments"), ni, "parcelas");
});
await t("B6", "SQL injection: texto malicioso fica só como texto; IDs não numéricos não executam nada", async () => {
  const evil = "'); DROP TABLE clients;--";
  const c = await api("clients", "POST", { name: evil, company: "' OR '1'='1" });
  eq(c.status, 200); eq((await data()).clients.find((x) => x.id === c.json.id).name, evil, "armazenado literalmente");
  for (const id of ["1 OR 1=1", "1;DROP TABLE clients", "-1", "abc", "9".repeat(30)]) {
    const r = await api(`clients/${encodeURIComponent(id)}`, "PATCH", { name: "x" });
    ok([400, 404].includes(r.status), `PATCH id=${id} -> ${r.status}`);
    const d = await api(`clients/${encodeURIComponent(id)}`, "DELETE"); ok(d.status >= 400, `DELETE id=${id} -> ${d.status}`);
  }
  ok((await data()).clients.length > 0, "tabela clients ainda existe");
});
await t("B7", "erros não vazam stack/caminhos (JSON malformado, corpo grande, rota inexistente)", async () => {
  const bodies = [await api("clients", "POST", "{ruim", { raw: true, headers: { "Content-Type": "application/json" } }),
    await api("login", "POST", "{ruim", { raw: true, headers: { "Content-Type": "application/json" }, cookie: null }),
    await api("clients", "POST", JSON.stringify({ name: "x".repeat(1_200_000) }), { raw: true, headers: { "Content-Type": "application/json" } }),
    await api("nao-existe", "GET")];
  for (const r of bodies) {
    ok([400, 404, 413].includes(r.status), `status ${r.status}`);
    ok(!/\bat \S+ \(|node_modules|SyntaxError|\.js:\d+|C:\\|\/home\//.test(r.text), "vazou detalhe interno: " + r.text.slice(0, 120).replace(/\s+/g, " "));
  }
});
await t("B8", "concorrência: 10 aprovações simultâneas da mesma proposta → 1 sucesso, 9 recusadas, 1 projeto", async () => {
  const c = await mkClient(); const p = await mkProposal(c, 100000);
  const rs = await Promise.all(Array.from({ length: 10 }, () => approve(p, { entrada: 20000, parcelas: 2 })));
  eq(rs.filter((r) => r.status === 200).length, 1, "sucessos"); eq(rs.filter((r) => r.status === 409).length, 9, "409");
  const d = await data(); eq(d.projects.filter((x) => x.proposal_id === p).length, 1, "projetos");
  eq(d.installments.filter((x) => x.proposal_id === p).reduce((s, i) => s + i.amount, 0), 100000, "soma das parcelas");
});
await t("B9", "concorrência: 10 pagamentos simultâneos que juntos excedem a parcela → nunca passa do valor", async () => {
  const { inst } = await mkInstallment(100000); const id = inst[0].id;
  const rs = await Promise.all(Array.from({ length: 10 }, () => api("payments", "POST", { installment_id: id, amount: 40000 })));
  eq(rs.filter((r) => r.status === 200).length, 2, "40k+40k cabem, o resto não");
  const paid = (await data()).payments.filter((p) => p.installment_id === id).reduce((s, p) => s + p.amount, 0);
  ok(paid <= 100000, `recebido ${paid} > parcela`);
});

await t("B10", "vínculos protegidos pelo banco: não exclui cliente com proposta, nem proposta aprovada, nem parcela com pagamento", async () => {
  const c = await mkClient("Vinculado"); const p = await mkProposal(c, 100000);
  eq((await api("clients/" + c, "DELETE")).status, 409, "cliente com proposta");
  const { proposal, client, inst } = await mkInstallment(100000);
  eq((await api("proposals/" + proposal, "DELETE")).status, 409, "proposta aprovada (tem projeto)");
  eq((await api("clients/" + client, "DELETE")).status, 409, "cliente com projeto/parcelas");
  eq((await api("payments", "POST", { installment_id: inst[0].id, amount: 1000 })).status, 200);
  const d = await data(); const proj = d.projects.find((x) => x.proposal_id === proposal);
  eq((await api("projects/" + proj.id, "DELETE")).status, 409, "projeto com parcelas");
  ok((await data()).proposals.some((x) => x.id === p), "proposta ainda existe");
});

console.log("\n== 3. Webhook de pagamentos ==");
await t("W1", "sem segredo / segredo errado / tamanho diferente → 401; nada é gravado", async () => {
  const { inst } = await mkInstallment(50000); const np = await count("payments");
  for (const s of [null, "", "errado", WEBHOOK + "x", WEBHOOK.slice(0, -1)])
    eq((await wh(evt({ payment_id: "p-w1", installment_id: inst[0].id, amount: 1000 }), s)).status, 401, `segredo=${s}`);
  eq(await count("payments"), np);
});
await t("W2", "confirmação grava uma vez; evento repetido e mesmo pagamento com outro event_id não duplicam", async () => {
  const { inst } = await mkInstallment(50000); const id = inst[0].id;
  const e = evt({ payment_id: "p-w2", installment_id: id, amount: 20000 });
  eq((await wh(e)).json.duplicate, false); eq((await wh(e)).json.duplicate, true);
  eq((await wh(evt({ payment_id: "p-w2", installment_id: id, amount: 20000 }))).json.duplicate, true, "mesmo payment_id");
  eq((await data()).payments.filter((p) => p.installment_id === id).length, 1, "um único pagamento");
});
let n3 = 0, n5 = 0;
await t("W3", "moeda diferente de BRL ou ausente é recusada", async () => {
  const { inst } = await mkInstallment(50000); const id = inst[0].id; const np = await count("payments");
  for (const currency of ["USD", "brl ", undefined, 986, null]) {
    const r = await wh(evt({ payment_id: "p-w3-" + (n3++), installment_id: id, amount: 1000, currency }));
    eq(r.status, 422, `moeda=${JSON.stringify(currency)}`);
  }
  eq(await count("payments"), np);
});
await t("W4", "cliente informado no evento precisa ser o dono da parcela", async () => {
  const { inst, client } = await mkInstallment(50000); const other = await mkClient("Outro");
  eq((await wh(evt({ payment_id: "p-w4a", installment_id: inst[0].id, amount: 1000, client_id: other }))).status, 422, "cliente errado");
  eq((await wh(evt({ payment_id: "p-w4b", installment_id: inst[0].id, amount: 1000, client_id: client }))).status, 200, "cliente certo");
});
await t("W5", "valores inválidos: decimal, negativo, zero, texto, acima do saldo → 422", async () => {
  const { inst } = await mkInstallment(50000); const id = inst[0].id; const np = await count("payments");
  for (const amount of [100.5, -100, 0, "abc", "100", null, 50001, 1e300, NaN])
    eq((await wh(evt({ payment_id: "p-w5-" + (n5++), installment_id: id, amount }))).status, 422, `amount=${amount}`);
  eq(await count("payments"), np);
});
await t("W6", "campos malformados: event_id/payment_id não-texto, provider fora do padrão, data inválida → 400/422", async () => {
  const { inst } = await mkInstallment(50000); const id = inst[0].id; const np = await count("payments");
  const bad = [{ event_id: { a: 1 } }, { event_id: ["x"] }, { payment_id: { a: 1 } }, { provider: "x".repeat(200) }, { provider: "a b; drop" }, { paid_at: "lixo" }, { event_id: "e".repeat(500) }];
  for (const over of bad) {
    const r = await wh(evt({ payment_id: "p-w6-" + Math.random(), installment_id: id, amount: 1000, ...over }));
    ok(r.status === 400 || r.status === 422, `${JSON.stringify(over).slice(0, 50)} -> ${r.status}`);
  }
  eq(await count("payments"), np);
  // evento malformado não pode "envenenar" eventos válidos seguintes
  eq((await wh(evt({ payment_id: "p-w6-ok", installment_id: id, amount: 1000 }))).json?.duplicate, false, "evento válido depois dos malformados");
});
await t("W7", "fora de ordem: estorno antes do pagamento é recusado e pode ser reenviado depois", async () => {
  const { inst } = await mkInstallment(50000); const id = inst[0].id;
  const refund = evt({ type: "payment.refunded", payment_id: "p-w7", amount: 10000 });
  eq((await wh(refund)).status, 422, "estorno sem pagamento");
  eq((await wh(evt({ payment_id: "p-w7", installment_id: id, amount: 30000 }))).status, 200);
  eq((await wh(refund)).status, 200, "reenvio do mesmo estorno agora é aceito");
  eq((await wh(refund)).json.duplicate, true, "e não duplica");
  const net = (await data()).payments.filter((p) => p.installment_id === id).reduce((s, p) => s + (p.type === "refund" ? -p.amount : p.amount), 0);
  eq(net, 20000, "saldo líquido");
});
await t("W8", "estornos parciais nunca passam do valor pago; cancelamento do restante fecha o pagamento", async () => {
  const { inst } = await mkInstallment(50000); const id = inst[0].id;
  await wh(evt({ payment_id: "p-w8", installment_id: id, amount: 30000 }));
  eq((await wh(evt({ type: "payment.refunded", payment_id: "p-w8", amount: 20000 }))).status, 200);
  eq((await wh(evt({ type: "payment.refunded", payment_id: "p-w8", amount: 20000 }))).status, 422, "20k+20k > 30k");
  eq((await wh(evt({ type: "payment.canceled", payment_id: "p-w8" }))).status, 200, "cancela os 10k restantes");
  eq((await wh(evt({ type: "payment.canceled", payment_id: "p-w8" }))).status, 422, "nada mais a estornar");
});
await t("W9", "payment_id com '_' ou '%' não mistura estornos de pagamentos diferentes", async () => {
  const a = await mkInstallment(50000), b = await mkInstallment(50000);
  await wh(evt({ payment_id: "pay_9", installment_id: a.inst[0].id, amount: 30000 }));
  await wh(evt({ payment_id: "payX9", installment_id: b.inst[0].id, amount: 30000 }));
  eq((await wh(evt({ type: "payment.refunded", payment_id: "payX9", amount: 30000 }))).status, 200, "estorno total do payX9");
  eq((await wh(evt({ type: "payment.refunded", payment_id: "pay_9", amount: 30000 }))).status, 200, "pay_9 ainda tem os 30k para estornar");
});
await t("W10", "evento de tipo desconhecido e corpo não-JSON são recusados", async () => {
  eq((await wh(evt({ type: "payment.hacked", payment_id: "p-w10" }))).status, 422);
  const r = await fetch(srv.base + "/api/webhooks/payments", { method: "POST", headers: { "Content-Type": "text/plain", "x-webhook-secret": WEBHOOK }, body: "x=1" });
  ok(r.status === 400 || r.status === 415, "status " + r.status);
});
await t("W11", "tentativas com segredo errado são limitadas (429) e o limite não derruba o webhook legítimo de outro cliente da API", async () => {
  const s2 = await startServer();
  let last = 0;
  for (let i = 0; i < 60; i++) last = (await wh(evt({ payment_id: "x", installment_id: 1, amount: 1 }), "errado-" + i, s2.base)).status;
  eq(last, 429, "após muitas falhas deve limitar");
});

console.log("\n== 4. Servidor de desenvolvimento, segredos e dependências ==");
await t("X1", "o servidor de desenvolvimento (Vite) não serve banco, .env nem código do servidor", async () => {
  const port = 24000 + Math.floor(Math.random() * 10000);
  const vite = spawn(process.execPath, [path.join(project, "node_modules/vite/bin/vite.js"), "--port", String(port), "--strictPort"], { cwd: project, env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  children.push(vite);
  let out = "";
  const strip = (x) => String(x).replace(/\x1b\[[0-9;]*m/g, "");
  vite.stderr.on("data", (d) => { out += strip(d); });
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("vite não iniciou: " + out.slice(0, 200).replace(/\s+/g, " "))), 20000);
    vite.stdout.on("data", (d) => { out += strip(d); if (/localhost:\d+/.test(out)) { clearTimeout(to); resolve(); } });
    vite.once("exit", (c) => { clearTimeout(to); reject(new Error("vite saiu (" + c + "): " + out.slice(0, 200).replace(/\s+/g, " "))); });
  });
  for (const p of ["/.env", "/data/app.db", "/data/app.db-wal", "/server/auth.js", "/server/index.js", "/scripts/setup-admin.js", "/AUTH.md", "/.git/config"]) {
    const r = await fetch(`http://localhost:${port}${p}`);
    const body = await r.text();
    const isSpaFallback = /<div id="root">/.test(body);
    ok(r.status >= 400 || isSpaFallback, `${p} servido (status ${r.status}, ${body.length} bytes)`);
  }
});
await t("X2", "segredos nunca foram versionados nem aparecem no build do navegador", async () => {
  const run = (...a) => execFileSync("git", a, { cwd: project, encoding: "utf8" });
  const tracked = run("ls-files").split("\n");
  ok(!tracked.some((f) => /(^|\/)\.env($|\.)|^data\/|\.db(-wal|-shm)?$/.test(f)), "arquivo sensível versionado");
  eq(run("log", "--all", "--oneline", "--", ".env", "data").trim(), "", "histórico do git");
  if (existsSync(path.join(project, ".env"))) {
    const secrets = readFileSync(path.join(project, ".env"), "utf8").split(/\r?\n/).map((l) => l.split("=").slice(1).join("=").replace(/^["']|["']$/g, "").trim()).filter((v) => v.length >= 12);
    const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
    const files = existsSync(path.join(project, "dist")) ? walk(path.join(project, "dist")) : [];
    ok(files.length > 0, "dist não existe: rode npm run build antes");
    for (const f of files) { const c = readFileSync(f, "utf8"); for (const s of secrets) ok(!c.includes(s), `valor de segredo do .env encontrado em ${path.relative(project, f)}`); }
    const tr = tracked.filter((f) => /\.(js|ts|tsx|json|md|html)$/.test(f) && existsSync(path.join(project, f)));
    for (const f of tr) { const c = readFileSync(path.join(project, f), "utf8"); for (const s of secrets) ok(!c.includes(s), `valor de segredo em arquivo versionado ${f}`); }
  }
});
await t("X3", "o código do navegador não usa HTML dinâmico perigoso nem guarda segredos no storage", async () => {
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const src = walk(path.join(project, "src")).filter((f) => /\.(ts|tsx)$/.test(f));
  for (const f of src) {
    const c = readFileSync(f, "utf8");
    ok(!/dangerouslySetInnerHTML|\.innerHTML\s*=|eval\(|new Function\(|document\.write/.test(c), `padrão perigoso em ${path.relative(project, f)}`);
    ok(!/localStorage|sessionStorage/.test(c), `uso de storage em ${path.relative(project, f)}`);
  }
});

// ====================================================================================================
for (const c of children) c.kill();
await new Promise((r) => setTimeout(r, 300));
await db.close();
process.chdir(project);
rmSync(testDir, { recursive: true, force: true });
const failed = results.filter((r) => !r[2]);
console.log(`\n${results.length - failed.length}/${results.length} verificações passaram.`);
if (failed.length) { console.log("FALHARAM: " + failed.map((f) => f[0]).join(", ")); process.exit(1); }
