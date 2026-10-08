// Testes do resumo da página inicial (GET /api/summary) com números conhecidos.   npm run test:summary
import { startHarness } from "./harness.js";
import { addDays, today } from "../server/dates.js";

const { api, t, eq, ok, finish, db } = await startHarness("dashboard-summary-test-");
const T = today();
const d = (n) => addDays(T, n);
const q = (from, to) => `summary?from=${from}&to=${to}`;
const sum = async (from = d(-9), to = d(0)) => (await api(q(from, to))).json;
const run = (sql, ...a) => db.prepare(sql).run(...a);
const id = async (sql, ...a) => Number((await run(sql, ...a)).lastInsertRowid);

console.log("\n== Permissões e validação ==");
await t("S1", "exige login e valida o período", async () => {
  for (const c of [null, "session=forjado"]) eq((await api("summary", "GET", undefined, { cookie: c })).status, 401);
  for (const bad of ["from=2026-02-31&to=2026-03-01", "from=abc", "to=2026-13-01", `from=${d(0)}&to=${d(-5)}`, "from=2000-01-01&to=2026-12-31", "from=1&from=2"])
    eq((await api(`summary?${bad}`)).status, 400, bad);
  eq((await api("summary?x[]=1")).status, 400, "parâmetro desconhecido é rejeitado");
});

console.log("\n== Banco vazio ==");
await t("S2", "sem dados tudo vem zerado, sem erro, e o lucro não é inventado", async () => {
  const r = await sum();
  eq(r.sold.value, 0); eq(r.received.value, 0); eq(r.balance.total, 0); eq(r.projection.next30, 0); eq(r.recurring.monthly, 0);
  eq(r.sold.delta, null, "sem período anterior não há comparação"); eq(r.hasPrevious, false);
  eq(r.profit.value, null); ok(/despesas/i.test(r.profit.reason), "explica por que não há lucro");
  eq(r.nextAction, null); eq(r.actions.length, 0); eq(r.series.length, 6);
  ok(r.series.every((m) => m.sold === 0 && m.received === 0));
});

// ---- dados conhecidos ----------------------------------------------------------------------------------
const A = await id("INSERT INTO clients (name, company) VALUES ('Ana', 'Alfa Ltda')");
const B = await id("INSERT INTO clients (name) VALUES ('Bruno')");
const prop = (cl, status, decided, value, created = d(-30), valid = null) =>
  id("INSERT INTO proposals (client_id, service, value, status, decided_at, created_at, valid_until) VALUES (?,?,?,?,?,?,?)", cl, "Landing page", value, status, decided, created, valid);
const p1 = await prop(A, "aprovada", d(-2), 100000);
await prop(A, "aprovada", d(-12), 40000);
await prop(B, "aprovada", d(-40), 7777);
await prop(B, "enviada", null, 50000, d(-10), d(2)); // aguardando, vence em 2 dias
await prop(B, "enviada", null, 30000, d(-20), d(-1)); // vencida
await prop(A, "rascunho", null, 12345);
const inst = (due, amount, label) => id("INSERT INTO installments (proposal_id, client_id, label, amount, due_date) VALUES (?,?,?,?,?)", p1, A, label, amount, due);
const i1 = await inst(d(-5), 60000, "Parcela 1");
await inst(d(10), 40000, "Parcela 2");
await inst(d(0), 5000, "Parcela 3");
const i4 = await inst(d(-30), 20000, "Entrada");
const pay = (inst, amount, at, type = "payment") => run("INSERT INTO payments (installment_id, client_id, amount, type, paid_at, source) VALUES (?,?,?,?,?, 'manual')", inst, A, amount, type, at);
await pay(i1, 10000, d(-3)); await pay(i1, 2000, d(-1), "refund"); await pay(i1, 3000, d(-15)); await pay(i4, 20000, d(-30));
const proj = (name, stage, deadline, cancelled = 0, checklist = "[]") => id("INSERT INTO projects (client_id, name, service, stage, deadline, cancelled, checklist) VALUES (?,?,?,?,?,?,?)", A, name, "Landing page", stage, deadline, cancelled, checklist);
await proj("Projeto Atrasado", "Design", d(-3));
const pSoon = await proj("Projeto Em Breve", "Desenvolvimento", d(4), 0, JSON.stringify([{ text: "Aprovação do layout", done: false }, { text: "Publicar", done: false }]));
await proj("Projeto Hoje", "Desenvolvimento", d(0));
await proj("Projeto Sem Materiais", "Aguardando materiais", null);
await proj("Projeto Em Revisão", "Revisão", null);
await proj("Projeto Entregue", "Entregue", d(-10));
await proj("Projeto Cancelado", "Design", d(-10), 1);
const opp = (name, stage, next, created) => id("INSERT INTO opportunities (name, email, stage, next_contact, created_at) VALUES (?,?,?,?,?)", name, `${name.replace(/\s/g, "")}@exemplo.com`, stage, next, created);
await opp("Lead Atrasado", "Contato iniciado", d(-2), d(-8));
await opp("Lead Hoje", "Negociação", d(0), d(-3));
await opp("Lead Sem Data", "Novo lead", null, d(-5));
await opp("Lead Ganho", "Ganho", null, d(-9));
const rec = (amount, period, status = "ativo") => run("INSERT INTO recurring (client_id, name, amount, period, status) VALUES (?,?,?,?,?)", A, "Contrato", amount, period, status);
await rec(6000, "mensal"); await rec(30000, "trimestral"); await rec(120000, "anual"); await rec(99999, "mensal", "pausado");

console.log("\n== Números ==");
await t("S3", "vendido e recebido no período, comparados ao período anterior (estorno abate)", async () => {
  const r = await sum();
  eq(r.sold.value, 100000); eq(r.sold.count, 1); eq(r.sold.previous, 40000); eq(r.sold.delta, 150);
  eq(r.received.value, 8000, "10000 - 2000 de estorno"); eq(r.received.previous, 3000); eq(r.received.delta, 167);
  eq(r.hasPrevious, true);
  eq(r.period.prevTo, d(-10)); eq(r.period.prevFrom, d(-19)); eq(r.period.days, 10);
});
await t("S4", "a receber, atrasado e projeção são coisas diferentes", async () => {
  const r = await sum();
  eq(r.balance.total, 94000, "49000 + 40000 + 5000 (a entrada já foi paga)");
  eq(r.balance.overdue.count, 1); eq(r.balance.overdue.value, 49000, "parcela parcialmente paga: só o saldo");
  eq(r.projection.next30, 45000, "só o que vence nos próximos 30 dias"); ok(/previsão/i.test(r.projection.note));
  ok(r.projection.next30 !== r.received.value, "projeção nunca é somada ao recebido");
});
await t("S5", "lucro só aparece com despesas registradas no período", async () => {
  eq((await sum()).profit.value, null);
  await run("INSERT INTO expenses (description, amount, date) VALUES ('Domínio', 3000, ?)", d(-1));
  const p = (await sum()).profit;
  eq(p.value, 5000, "8000 recebidos - 3000 de despesa"); eq(p.expenses, 3000);
  eq((await sum(d(-60), d(-50))).profit.value, null, "outro período sem despesa continua sem lucro");
});
await t("S6", "recorrência contratada: trimestral e anual viram equivalente mensal; pausados ficam de fora", async () => {
  const r = await sum();
  eq(r.recurring.monthly, 26000, "6000 + 30000/3 + 120000/12"); eq(r.recurring.active, 3);
});
await t("S7", "projetos: atrasados, entregas próximas, materiais, aprovações; entregues/cancelados não contam", async () => {
  const r = (await sum()).projects;
  eq(r.active, 5, "entregue e cancelado fora"); eq(r.late.map((p) => p.name).join(), "Projeto Atrasado");
  ok(r.dueSoon.some((p) => p.name === "Projeto Em Breve") && r.dueSoon.some((p) => p.name === "Projeto Hoje"));
  eq(r.awaitingMaterials.length, 1); eq(r.inReview.length, 1);
  eq(r.needAttention, 3, "atrasado + sem materiais + em revisão");
  eq(r.pendingApprovals.length, 1); eq(r.pendingApprovals[0].project_id, pSoon);
});
await t("S8", "propostas aguardando (válidas) separadas das vencidas; funil em aberto", async () => {
  const r = await sum();
  eq(r.proposals.waiting, 1); eq(r.proposals.waitingValue, 50000); eq(r.proposals.expired, 1);
  eq(r.funnel.open, 3, "ganho não conta"); eq(r.funnel.dueContacts, 2);
});
await t("S9", "central de ações: ordenada por urgência, com a cobrança atrasada primeiro, e a próxima ação é a primeira", async () => {
  const r = await sum();
  eq(r.actions[0].kind, "cobranca"); eq(r.actions[0].amount, 49000); eq(r.actions[0].tone, "bad");
  eq(JSON.stringify(r.nextAction), JSON.stringify(r.actions[0]));
  for (let i = 1; i < r.actions.length; i++) ok(r.actions[i].priority >= r.actions[i - 1].priority, "prioridade não decrescente");
  const kinds = new Set(r.actions.map((a) => a.kind));
  for (const k of ["cobranca", "entrega", "retorno", "proposta", "material", "aprovacao"]) ok(kinds.has(k), `falta ação do tipo ${k}`);
  ok(r.actions.every((a) => ["financeiro", "projetos", "funil", "propostas"].includes(a.page)), "toda ação aponta para uma tela");
  ok(r.actions.some((a) => /Defina o próximo contato/.test(a.title)), "lead sem data de retorno");
  ok(!r.actions.some((a) => /Cancelado|Entregue/.test(a.title)), "projeto entregue/cancelado não vira ação");
  ok(r.actions.length <= 20);
});
await t("S10", "série dos 6 meses soma exatamente o que foi vendido e recebido", async () => {
  const r = await sum();
  eq(r.series.length, 6);
  eq(r.series.reduce((a, m) => a + m.sold, 0), 147777, "100000 + 40000 + 7777");
  eq(r.series.reduce((a, m) => a + m.received, 0), 31000, "10000 - 2000 + 3000 + 20000");
});
await t("S11", "o resumo não altera nada e responde igual duas vezes", async () => {
  const before = JSON.stringify(await sum());
  eq(JSON.stringify(await sum()), before);
});

await finish();
