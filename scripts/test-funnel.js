// Testes do funil de vendas (oportunidades) e da captura pública de leads.   npm run test:funnel
import { startHarness } from "./harness.js";

const { api, t, eq, ok, finish, db } = await startHarness("dashboard-funnel-test-");

let seq = 0;
const lead = (over = {}) => ({ name: `Lead Teste ${++seq}`, email: `lead${seq}-${Date.now()}@exemplo.com`, ...over });
const mk = async (over) => { const r = await api("opportunities", "POST", lead(over)); eq(r.status, 201, "criar oportunidade: " + r.text); return r.json.id; };
const get = async (id) => (await api(`opportunities/${id}`)).json;
const count = async (table) => Number((await db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).n);

console.log("\n== Permissões ==");
await t("F1", "todas as rotas do funil recusam chamada sem login", async () => {
  const id = await mk();
  const routes = [["opportunities"], ["opportunities/board"], ["opportunities/meta"], [`opportunities/${id}`], ["opportunities", "POST", lead()],
    [`opportunities/${id}`, "PATCH", { name: "x x" }], [`opportunities/${id}/move`, "POST", { stage: "Ganho" }], [`opportunities/${id}/notes`, "POST", { text: "oi" }],
    [`opportunities/${id}/convert`, "POST", {}], [`opportunities/${id}`, "DELETE"]];
  for (const [route, method, body] of routes)
    for (const c of [null, "session=forjado", "session=" + "A".repeat(43)])
      eq((await api(route, method ?? "GET", body, { cookie: c })).status, 401, `${method ?? "GET"} /api/${route} cookie=${c ?? "nenhum"}`);
});

console.log("\n== Cadastro e validação ==");
await t("F2", "dados inválidos são recusados (400) e nada é gravado; campos privilegiados são ignorados", async () => {
  const n0 = await count("opportunities");
  const bad = [
    {}, { name: "a" }, { name: { x: 1 }, email: "a@b.co" }, { name: "Fulano", email: "sem-arroba" }, { name: "Fulano", phone: "abc" },
    { name: "Fulano" }, { name: "Fulano", email: "a@b.co", source: "Origem inventada" }, { name: "Fulano", email: "a@b.co", value: -1 },
    { name: "Fulano", email: "a@b.co", value: 10.5 }, { name: "Fulano", email: "a@b.co", value: 1e15 }, { name: "Fulano", email: "a@b.co", next_contact: "31/12/2026" },
    { name: "Fulano", email: "a@b.co", next_contact: "2026-02-31" }, { name: "Fulano", email: "a@b.co", notes: "n".repeat(5000) }, { name: "Fulano", phone: "12" },
  ];
  for (const body of bad) { const r = await api("opportunities", "POST", body); eq(r.status, 400, JSON.stringify(body).slice(0, 70)); }
  eq(await count("opportunities"), n0, "nada gravado");
  const id = await mk({ stage: "Ganho", client_id: 1, proposal_id: 1, closed_at: "2000-01-01", id: 999999, demo: 1 });
  const o = await get(id);
  eq(o.stage, "Novo lead", "etapa não pode vir do cliente"); eq(o.client_id, null); eq(o.proposal_id, null); eq(o.closed_at, null); eq(o.demo, 0); ok(o.id !== 999999);
});
await t("F3", "edição valida os campos e registra o histórico", async () => {
  const id = await mk();
  eq((await api(`opportunities/${id}`, "PATCH", { name: "Novo Nome", company: "Empresa X", value: 123400, next_contact: "2026-12-01", source: "Indicação" })).status, 200);
  const o = await get(id);
  eq(o.name, "Novo Nome"); eq(o.value, 123400); eq(o.source, "Indicação");
  ok(o.events.some((e) => /Dados atualizados/.test(e.text)), "histórico da edição");
  eq((await api(`opportunities/${id}`, "PATCH", { value: -5 })).status, 400);
  eq((await api(`opportunities/${id}`, "PATCH", { email: "", phone: "" })).status, 400, "não pode ficar sem contato");
  eq((await api(`opportunities/${id}`, "PATCH", { stage: "Ganho" })).status, 200, "campo desconhecido é ignorado");
  eq((await get(id)).stage, "Novo lead", "PATCH não muda etapa");
  eq((await api("opportunities/99999999", "PATCH", { name: "Fulano" })).status, 404);
  eq((await api("opportunities/abc", "PATCH", { name: "Fulano" })).status, 404);
});

console.log("\n== Etapas ==");
await t("F4", "mover etapas: inválida, perda exige motivo, ganho vira cliente, reabrir limpa o fechamento", async () => {
  const id = await mk({ company: `Empresa Etapas ${Date.now()}` });
  eq((await api(`opportunities/${id}/move`, "POST", { stage: "Inventada" })).status, 400);
  eq((await api(`opportunities/${id}/move`, "POST", {})).status, 400);
  for (const s of ["Contato iniciado", "Reunião/briefing", "Proposta enviada", "Negociação"]) eq((await api(`opportunities/${id}/move`, "POST", { stage: s })).status, 200, s);
  eq((await api(`opportunities/${id}/move`, "POST", { stage: "Perdido" })).status, 400, "perda sem motivo");
  eq((await api(`opportunities/${id}/move`, "POST", { stage: "Perdido", lost_reason: "x".repeat(400) })).status, 400, "motivo longo demais");
  eq((await api(`opportunities/${id}/move`, "POST", { stage: "Perdido", lost_reason: "Preço" })).status, 200);
  let o = await get(id); eq(o.stage, "Perdido"); eq(o.lost_reason, "Preço"); ok(o.closed_at, "closed_at definido");
  eq((await api(`opportunities/${id}/move`, "POST", { stage: "Negociação" })).status, 200, "reabrir");
  o = await get(id); eq(o.lost_reason, null); eq(o.closed_at, null);
  const clientsBefore = await count("clients");
  const won = await api(`opportunities/${id}/move`, "POST", { stage: "Ganho" });
  eq(won.status, 200); eq(won.json.conversion.created, true);
  eq(await count("clients"), clientsBefore + 1, "ganho cria 1 cliente");
  const again = await api(`opportunities/${id}/move`, "POST", { stage: "Ganho" });
  eq(again.json.moved, false, "mesma etapa é idempotente"); eq(await count("clients"), clientsBefore + 1);
  o = await get(id); ok(o.client, "cliente vinculado"); ok(o.events.length >= 7, "histórico completo");
});

console.log("\n== Conversão sem duplicar ==");
await t("F5", "reaproveita cliente existente por e-mail, telefone (formatos diferentes) e empresa; senão cria; repetir não duplica", async () => {
  const tag = Date.now();
  const cli = (await api("clients", "POST", { name: "Cliente Antigo", company: `Empresa Única ${tag}`, email: `Antigo${tag}@Exemplo.com`, phone: "(11) 98888-7777" })).json.id;
  const n0 = await count("clients");
  const byMail = await mk({ email: `antigo${tag}@exemplo.COM` });
  const r1 = await api(`opportunities/${byMail}/convert`, "POST", {});
  eq(r1.json.client_id, cli, "por e-mail"); eq(r1.json.created, false); eq(r1.json.matched_by, "e-mail");
  const byPhone = await mk({ email: undefined, phone: "+55 11 98888-7777" });
  const r2 = await api(`opportunities/${byPhone}/convert`, "POST", {});
  eq(r2.json.client_id, cli, "por telefone"); eq(r2.json.matched_by, "telefone");
  const byCompany = await mk({ company: `EMPRESA única ${tag}` });
  const r3 = await api(`opportunities/${byCompany}/convert`, "POST", {});
  eq(r3.json.client_id, cli, "por empresa"); eq(r3.json.matched_by, "empresa");
  eq(await count("clients"), n0, "nenhum cliente novo");
  const fresh = await mk({ company: `Empresa Nova ${tag}` });
  const r4 = await api(`opportunities/${fresh}/convert`, "POST", {});
  eq(r4.json.created, true); eq(await count("clients"), n0 + 1);
  const r5 = await api(`opportunities/${fresh}/convert`, "POST", {});
  eq(r5.json.created, false); eq(r5.json.client_id, r4.json.client_id); eq(r5.json.matched_by, "vinculado"); eq(await count("clients"), n0 + 1, "repetir não duplica");
});
await t("F6", "conversões simultâneas da mesma oportunidade criam um único cliente", async () => {
  const id = await mk({ company: `Empresa Paralela ${Date.now()}` });
  const n0 = await count("clients");
  const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? api(`opportunities/${id}/convert`, "POST", {}) : api(`opportunities/${id}/move`, "POST", { stage: "Ganho" }))));
  for (const r of rs) eq(r.status, 200, r.text);
  eq(await count("clients"), n0 + 1, "um único cliente");
  eq((await get(id)).client_id !== null, true);
});
await t("F7", "converter criando proposta: rascunho com o valor; repetir não cria outra; entradas inválidas são recusadas", async () => {
  const id = await mk({ service: "Landing page", value: 150000, company: `Empresa Proposta ${Date.now()}` });
  eq((await api(`opportunities/${id}/convert`, "POST", { create_proposal: "sim" })).status, 400);
  const np = await count("proposals");
  const r = await api(`opportunities/${id}/convert`, "POST", { create_proposal: true });
  eq(r.status, 200, r.text); ok(r.json.proposal_id, "id da proposta"); eq(await count("proposals"), np + 1);
  const prop = (await api("data")).json.proposals.find((p) => p.id === r.json.proposal_id);
  eq(prop.status, "rascunho"); eq(prop.value, 150000); eq(prop.service, "Landing page");
  eq((await api(`opportunities/${id}/convert`, "POST", { create_proposal: true })).json.proposal_id, r.json.proposal_id);
  eq(await count("proposals"), np + 1, "não duplica proposta");
  const semValor = await mk({ service: "Landing page", value: 0 });
  eq((await api(`opportunities/${semValor}/convert`, "POST", { create_proposal: true })).status, 400, "sem valor");
  eq((await api(`opportunities/${id}`, "DELETE")).status, 409, "com proposta não exclui");
});
await t("F8", "excluir: remove oportunidade e histórico; inexistente dá 404", async () => {
  const id = await mk();
  await api(`opportunities/${id}/notes`, "POST", { text: "uma nota" });
  eq((await api(`opportunities/${id}`, "DELETE")).status, 200);
  eq((await api(`opportunities/${id}`)).status, 404);
  eq(Number((await db.prepare("SELECT count(*) AS n FROM opportunity_events WHERE opportunity_id=?").get(id)).n), 0);
  eq((await api(`opportunities/${id}`, "DELETE")).status, 404);
  eq((await api(`opportunities/${await mk()}/notes`, "POST", { text: "   " })).status, 400);
  eq((await api(`opportunities/${await mk()}/notes`, "POST", { text: "n".repeat(3000) })).status, 400);
});

console.log("\n== Listas: paginação, ordenação, busca e injeção ==");
await t("F9", "paginação, ordenação e filtros no servidor", async () => {
  const tag = `P${Date.now()}`;
  for (let i = 0; i < 27; i++) await mk({ name: `${tag} ${String.fromCharCode(65 + (i % 26))}${i}`, source: i % 2 ? "Instagram" : "Google" });
  const p1 = (await api(`opportunities?q=${tag}&pageSize=10&page=1&sort=nome&dir=asc`)).json;
  eq(p1.total, 27); eq(p1.pages, 3); eq(p1.items.length, 10);
  const p3 = (await api(`opportunities?q=${tag}&pageSize=10&page=3&sort=nome&dir=asc`)).json;
  eq(p3.items.length, 7);
  const names = [...p1.items, ...(await api(`opportunities?q=${tag}&pageSize=10&page=2&sort=nome&dir=asc`)).json.items, ...p3.items].map((o) => o.name);
  eq(new Set(names).size, 27, "sem repetição entre páginas");
  eq(JSON.stringify(names), JSON.stringify([...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }))), "ordem alfabética");
  eq((await api(`opportunities?q=${tag}&source=Instagram&pageSize=100`)).json.total, 13, "filtro por origem");
  eq((await api(`opportunities?q=${tag}&pageSize=1000`)).json.pageSize, 100, "pageSize limitado a 100");
  eq((await api("opportunities?page=abc")).status, 400);
  eq((await api("opportunities?page=1&page=2")).status, 400, "parâmetro repetido");
  eq((await api("opportunities?sort=desconhecido")).status, 200, "ordenação desconhecida usa a padrão");
});
await t("F10", "SQL injection e curingas: nada é executado e '%' '_' são literais", async () => {
  const before = await count("opportunities");
  const evil = encodeURIComponent("'; DROP TABLE opportunities;--");
  for (const q of [`q=${evil}`, `sort=${evil}`, `dir=${evil}`, `stage=${evil}`, `source=${evil}`, `service=${evil}`, "q=%25%25%25%25", "q=_"]) {
    const r = await api(`opportunities?${q}`);
    ok(r.status === 200 || r.status === 400, `${q.slice(0, 40)} -> ${r.status}`);
  }
  eq(await count("opportunities"), before, "tabela intacta");
  const a = await mk({ name: "Desconto 100% Teste" }); await mk({ name: "Desconto 100 Teste" }); await mk({ name: "AB_C Teste" }); await mk({ name: "ABXC Teste" });
  const pct = (await api(`opportunities?q=${encodeURIComponent("100% Teste")}&pageSize=100`)).json;
  eq(pct.total, 1, "% literal"); eq(pct.items[0].id, a);
  eq((await api(`opportunities?q=${encodeURIComponent("AB_C")}&pageSize=100`)).json.total, 1, "_ literal");
});
await t("F11", "quadro: totais por etapa, limite de cartões e resumo de ganhos/perdas", async () => {
  const lostId = await mk({ value: 70000 });
  await api(`opportunities/${lostId}/move`, "POST", { stage: "Perdido", lost_reason: "Sem orçamento" });
  const b = (await api("opportunities/board")).json;
  eq(b.stages.map((s) => s.stage).join("|"), "Novo lead|Contato iniciado|Reunião/briefing|Proposta enviada|Negociação");
  for (const s of b.stages) { ok(s.items.length <= 40 && s.items.length <= s.total, "limite de cartões"); ok(Number.isInteger(s.value)); }
  ok(b.won.total >= 1, "ganhos do período"); ok(b.lost.total >= 1, "perdas do período");
  const meta = (await api("opportunities/meta")).json;
  eq(meta.stages.length, 7);
});

console.log("\n== Captura pública de leads ==");
const resetLeadLimit = () => db.prepare("DELETE FROM auth_attempts WHERE key LIKE 'lead:%'").run();
const post = (body, opt = {}) => api("public/lead", "POST", body, { cookie: null, ...opt });
await t("F12", "formulário público: grava lead sem login e não devolve dados; só aceita JSON", async () => {
  await resetLeadLimit();
  const n0 = await count("opportunities");
  const r = await post({ name: "Visitante Real", email: `visitante${Date.now()}@exemplo.com`, phone: "(12) 99999-0000", company: "Loja X", service: "E-commerce", message: "Quero uma loja virtual." });
  eq(r.status, 201); eq(JSON.stringify(r.json), '{"ok":true}', "resposta mínima");
  eq(await count("opportunities"), n0 + 1);
  const o = (await api("opportunities?q=Visitante Real")).json.items[0];
  eq(o.source, "Formulário do site"); eq(o.stage, "Novo lead"); eq(o.notes, "Quero uma loja virtual.");
  const form = await api("public/lead", "POST", "name=x", { cookie: null, raw: true, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  eq(form.status, 415);
  eq((await api("public/lead", "GET", undefined, { cookie: null })).status, 401, "sem rota GET (cai no guarda de login)");
  eq((await api("public/brand", "GET", undefined, { cookie: null })).status, 200);
});
await t("F13", "formulário público valida entradas e ignora robôs (campo-isca)", async () => {
  await resetLeadLimit();
  const n0 = await count("opportunities");
  for (const body of [{}, { name: "A", email: "a@b.co" }, { name: "Fulano" }, { name: "Fulano", email: "x" }, { name: "Fulano", email: "a@b.co", message: "m".repeat(2500) },
    { name: { a: 1 }, email: "a@b.co" }, { name: "Fulano", phone: "123" }, { name: "Fulano", email: "a@b.co", company: "c".repeat(200) }])
    eq((await post(body)).status, 400, JSON.stringify(body).slice(0, 60));
  eq(await count("opportunities"), n0, "nada gravado");
  const bot = await post({ name: "Robô Spam", email: "spam@exemplo.com", website: "http://spam.example" });
  eq(bot.status, 201, "finge sucesso"); eq(await count("opportunities"), n0, "mas não grava");
});
await t("F14", "mesmo contato em 30 dias vira histórico (sem oportunidade duplicada); cliente existente é vinculado", async () => {
  await resetLeadLimit();
  const mail = `repetido${Date.now()}@exemplo.com`;
  await post({ name: "Contato Repetido", email: mail, message: "primeira" });
  const n1 = await count("opportunities");
  await post({ name: "Contato Repetido", email: mail.toUpperCase(), message: "segunda mensagem", service: "Landing page" });
  eq(await count("opportunities"), n1, "sem duplicar");
  const o = (await api(`opportunities?q=${encodeURIComponent(mail)}`)).json.items[0];
  ok((await get(o.id)).events.some((e) => /segunda mensagem/.test(e.text)), "novo contato no histórico");
  const cm = `cliente${Date.now()}@exemplo.com`;
  const cid = (await api("clients", "POST", { name: "Já Cliente", email: cm })).json.id;
  await post({ name: "Já Cliente", email: cm });
  eq((await api(`opportunities?q=${encodeURIComponent(cm)}`)).json.items[0].client_id, cid, "vinculado ao cliente existente");
});
await t("F15", "política de origem: outro site é bloqueado até ser liberado; configuração é validada", async () => {
  await resetLeadLimit();
  const evil = "https://site-malicioso.example";
  const r1 = await post({ name: "Fulano", email: "a@b.co" }, { origin: evil });
  eq(r1.status, 403); eq(r1.headers.get("access-control-allow-origin"), null);
  eq((await api("public/lead", "OPTIONS", undefined, { cookie: null, origin: evil })).status, 403, "preflight bloqueado");
  for (const bad of ["http://inseguro.com.br", "https://site.com/caminho", "https://*.com", "javascript:alert(1)", "https://a.example,".repeat(11)])
    eq((await api("settings", "PUT", { lead_allowed_origins: bad })).status, 400, bad.slice(0, 30));
  const ally = "https://meusite.com.br";
  eq((await api("settings", "PUT", { lead_allowed_origins: ally })).status, 200);
  const pre = await api("public/lead", "OPTIONS", undefined, { cookie: null, origin: ally });
  eq(pre.status, 204); eq(pre.headers.get("access-control-allow-origin"), ally); ok(/POST/.test(pre.headers.get("access-control-allow-methods") ?? ""));
  const okPost = await post({ name: "Vindo do Site", email: `site${Date.now()}@exemplo.com` }, { origin: ally });
  eq(okPost.status, 201); eq(okPost.headers.get("access-control-allow-origin"), ally); ok(/Origin/i.test(okPost.headers.get("vary") ?? ""), "Vary: Origin");
  eq((await post({ name: "Fulano", email: "a@b.co" }, { origin: evil })).status, 403, "outras origens continuam bloqueadas");
  await api("settings", "PUT", { lead_allowed_origins: "" });
});
await t("F16", "limite de envios: 10 por hora por IP; não bloqueia o login", async () => {
  await resetLeadLimit();
  const statuses = [];
  for (let i = 0; i < 12; i++) statuses.push((await post({ name: "Enchente", email: `flood${i}${Date.now()}@exemplo.com` })).status);
  eq(statuses.slice(0, 10).every((s) => s === 201), true, "os 10 primeiros passam");
  eq(statuses.slice(10).every((s) => s === 429), true, "o 11º em diante é limitado");
  const last = statuses[11];
  eq(last, 429, "deve limitar");
  const r = await post({ name: "Depois do limite", email: "depois@exemplo.com" });
  eq(r.status, 429); ok(r.headers.get("retry-after"), "Retry-After");
  eq((await api("session", "GET", undefined, { cookie: null })).status, 200, "login/sessão seguem funcionando");
  eq((await api("opportunities")).status, 200, "painel segue funcionando");
});

console.log("\n== Dados de exemplo ==");
await t("F17", "exemplos incluem oportunidades e a remoção apaga só os exemplos (inclusive o histórico)", async () => {
  const real = await mk({ name: "Oportunidade Real Que Fica" });
  eq((await api("demo", "POST", {})).status, 200);
  const demo = (await api("opportunities?pageSize=100&q=exemplo")).json;
  ok(Number((await db.prepare("SELECT count(*) AS n FROM opportunities WHERE demo=1").get()).n) === 6, "6 oportunidades de exemplo");
  ok(demo.total >= 1);
  eq((await api("demo", "DELETE", {})).status, 200);
  eq(Number((await db.prepare("SELECT count(*) AS n FROM opportunities WHERE demo=1").get()).n), 0);
  eq(Number((await db.prepare("SELECT count(*) AS n FROM opportunity_events WHERE opportunity_id NOT IN (SELECT id FROM opportunities)").get()).n), 0, "sem histórico órfão");
  eq((await api(`opportunities/${real}`)).status, 200, "a real continua");
});

await finish();
