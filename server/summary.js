// Resumo da página inicial, calculado no banco (não baixa todos os registros).
// Separa DINHEIRO CONFIRMADO (vendido, recebido) de PROJEÇÃO (a vencer) e só mostra lucro com despesas registradas.
import { Router } from "express";
import { db } from "./db.js";
import { addDays, diffDays, today } from "./dates.js";
import { Invalid, isDate } from "./validate.js";

export const summaryRouter = Router();

const OPEN_OPP = ["Novo lead", "Contato iniciado", "Reunião/briefing", "Proposta enviada", "Negociação"];
const NET = "CASE WHEN type='refund' THEN -amount ELSE amount END";
const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);
const monthlyOf = (r) => (r.period === "mensal" ? r.amount : r.period === "trimestral" ? r.amount / 3 : r.amount / 12);

function parseRange(query) {
  for (const [k, v] of Object.entries(query)) if (!["from", "to"].includes(k) || typeof v !== "string" || v.length > 20) throw new Invalid(`Parâmetro inválido: ${k}`);
  const t = today();
  const monthStart = `${t.slice(0, 8)}01`;
  const from = query.from ?? monthStart;
  const lastDay = new Date(Number(t.slice(0, 4)), Number(t.slice(5, 7)), 0).getDate();
  const to = query.to ?? `${t.slice(0, 8)}${String(lastDay).padStart(2, "0")}`;
  if (!isDate(from) || !isDate(to)) throw new Invalid("Período inválido (use AAAA-MM-DD)");
  if (from > to) throw new Invalid("A data inicial deve ser anterior à final");
  const days = diffDays(from, to) + 1;
  if (days > 1830) throw new Invalid("Período máximo: 5 anos");
  const prevTo = addDays(from, -1);
  return { from, to, days, prevFrom: addDays(prevTo, -(days - 1)), prevTo };
}

const sold = async (a, b) => {
  const r = await db.prepare("SELECT COALESCE(SUM(value),0) AS v, count(*) AS n FROM proposals WHERE status='aprovada' AND decided_at BETWEEN ? AND ?").get(a, b);
  return { value: Number(r.v), count: Number(r.n) };
};
const received = async (a, b) => Number((await db.prepare(`SELECT COALESCE(SUM(${NET}),0) AS n FROM payments WHERE paid_at BETWEEN ? AND ?`).get(a, b)).n);
const expenses = async (a, b) => {
  const r = await db.prepare("SELECT COALESCE(SUM(amount),0) AS v, count(*) AS n FROM expenses WHERE date BETWEEN ? AND ?").get(a, b);
  return { value: Number(r.v), count: Number(r.n) };
};

summaryRouter.get("/", async (req, res) => {
  try {
    const range = parseRange(req.query);
    const t = today();

    // --- Dinheiro confirmado no período e no período anterior
    const [s1, s0, r1, r0, ex] = await Promise.all([
      sold(range.from, range.to), sold(range.prevFrom, range.prevTo), received(range.from, range.to), received(range.prevFrom, range.prevTo), expenses(range.from, range.to),
    ]);
    const hasPrev = (await db.prepare("SELECT count(*) AS n FROM proposals WHERE status='aprovada' AND decided_at <= ?").get(range.prevTo)).n > 0
      || (await db.prepare("SELECT count(*) AS n FROM payments WHERE paid_at <= ?").get(range.prevTo)).n > 0;

    // --- A receber: contratado em parcelas menos o já recebido (líquido de estornos)
    const open = await db.prepare(`SELECT * FROM (
        SELECT i.id, i.client_id, i.label, i.due_date, i.amount,
               i.amount - COALESCE((SELECT SUM(${NET}) FROM payments p WHERE p.installment_id = i.id), 0) AS remaining,
               (SELECT COALESCE(NULLIF(c.company, ''), c.name) FROM clients c WHERE c.id = i.client_id) AS client
          FROM installments i) WHERE remaining > 0 ORDER BY due_date, id`).all();
    const balance = open.reduce((a, i) => a + i.remaining, 0);
    const overdue = open.filter((i) => i.due_date < t);
    const horizon = addDays(t, 30);
    const projection = open.filter((i) => i.due_date >= t && i.due_date <= horizon).reduce((a, i) => a + i.remaining, 0);

    // --- Projetos
    const projects = await db.prepare(
      "SELECT p.id, p.name, p.service, p.stage, p.deadline, p.checklist, COALESCE(NULLIF(c.company, ''), c.name) AS client FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.cancelled = 0 AND p.stage <> 'Entregue' ORDER BY p.deadline IS NULL, p.deadline, p.id",
    ).all();
    const soon = addDays(t, 7);
    const lateProjects = projects.filter((p) => p.deadline && p.deadline < t);
    const dueSoon = projects.filter((p) => p.deadline && p.deadline >= t && p.deadline <= soon);
    const awaitingMaterials = projects.filter((p) => p.stage === "Aguardando materiais");
    const inReview = projects.filter((p) => p.stage === "Revisão");
    const pendingApprovals = projects.flatMap((p) => {
      let items = [];
      try { items = JSON.parse(p.checklist || "[]"); } catch { /* checklist inválido é ignorado */ }
      return items.filter((i) => !i.done && /aprova/i.test(i.text)).map((i) => ({ project_id: p.id, project: p.name ?? p.service, client: p.client, item: i.text }));
    });
    const needAttention = new Set([...lateProjects, ...awaitingMaterials, ...inReview].map((p) => p.id)).size;
    const brief = (p) => ({ id: p.id, name: p.name ?? p.service, client: p.client, stage: p.stage, deadline: p.deadline });

    // --- Propostas aguardando resposta
    const proposalsRaw = await db.prepare(
      "SELECT p.id, p.service, p.value, p.valid_until, p.created_at, COALESCE(NULLIF(c.company, ''), c.name) AS client FROM proposals p JOIN clients c ON c.id = p.client_id WHERE p.status = 'enviada' ORDER BY p.created_at, p.id",
    ).all();
    const proposals = proposalsRaw.map((p) => ({ ...p, age_days: diffDays(p.created_at.slice(0, 10), t), expired: Boolean(p.valid_until && p.valid_until < t) }));
    const waiting = proposals.filter((p) => !p.expired);

    // --- Funil
    const oppSum = await db.prepare(`SELECT count(*) AS n, COALESCE(SUM(value),0) AS v FROM opportunities WHERE stage IN (${OPEN_OPP.map(() => "?").join(",")})`).get(...OPEN_OPP);
    const opps = await db.prepare(
      `SELECT id, name, company, stage, next_contact, created_at FROM opportunities WHERE stage IN (${OPEN_OPP.map(() => "?").join(",")}) ORDER BY next_contact IS NULL, next_contact, id LIMIT 200`,
    ).all(...OPEN_OPP);

    // --- Recorrência contratada
    const rec = await db.prepare("SELECT amount, period FROM recurring WHERE status = 'ativo'").all();
    const mrr = Math.round(rec.reduce((a, r) => a + monthlyOf(r), 0));

    // --- Série dos últimos 6 meses (até o fim do período): vendido x recebido
    const endMonth = range.to.slice(0, 7);
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const [y, m] = endMonth.split("-").map(Number);
      const d = new Date(y, m - 1 - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    const first = `${months[0]}-01`;
    const soldBy = new Map((await db.prepare("SELECT substr(decided_at,1,7) AS m, SUM(value) AS v FROM proposals WHERE status='aprovada' AND decided_at >= ? GROUP BY 1").all(first)).map((r) => [r.m, Number(r.v)]));
    const recvBy = new Map((await db.prepare(`SELECT substr(paid_at,1,7) AS m, SUM(${NET}) AS v FROM payments WHERE paid_at >= ? GROUP BY 1`).all(first)).map((r) => [r.m, Number(r.v)]));
    const series = months.map((m) => ({ month: m, sold: soldBy.get(m) ?? 0, received: recvBy.get(m) ?? 0 }));

    // --- Central de ações (menor prioridade = mais urgente)
    const actions = [];
    const add = (priority, kind, tone, title, detail, page, extra = {}) => actions.push({ priority, kind, tone, title, detail, page, ...extra });
    for (const i of overdue.slice(0, 8)) add(10, "cobranca", "bad", `Cobrar ${i.client}`, `${i.label ?? "Parcela"} venceu há ${diffDays(i.due_date, t)} dia(s)`, "financeiro", { amount: i.remaining, ref: i.id, date: i.due_date });
    for (const i of open.filter((x) => x.due_date === t).slice(0, 5)) add(25, "cobranca", "warn", `Cobrança vence hoje: ${i.client}`, i.label ?? "Parcela", "financeiro", { amount: i.remaining, ref: i.id, date: i.due_date });
    for (const p of lateProjects.slice(0, 8)) add(15, "entrega", "bad", `Entrega atrasada: ${p.name ?? p.service}`, `${p.client} · prazo era ${p.deadline}`, "projetos", { ref: p.id, date: p.deadline });
    for (const p of projects.filter((x) => x.deadline === t)) add(26, "entrega", "warn", `Entrega hoje: ${p.name ?? p.service}`, p.client, "projetos", { ref: p.id, date: p.deadline });
    for (const p of projects.filter((x) => x.deadline && x.deadline > t && x.deadline <= addDays(t, 3))) add(40, "entrega", "info", `Entrega em breve: ${p.name ?? p.service}`, `${p.client} · prazo ${p.deadline}`, "projetos", { ref: p.id, date: p.deadline });
    for (const o of opps.filter((x) => x.next_contact && x.next_contact < t).slice(0, 8)) add(20, "retorno", "bad", `Retornar para ${o.name}`, `${o.stage} · retorno atrasado desde ${o.next_contact}`, "funil", { ref: o.id, date: o.next_contact });
    for (const o of opps.filter((x) => x.next_contact === t)) add(30, "retorno", "warn", `Retornar hoje: ${o.name}`, o.stage, "funil", { ref: o.id, date: o.next_contact });
    for (const o of opps.filter((x) => !x.next_contact && diffDays(x.created_at.slice(0, 10), t) >= 3).slice(0, 5)) add(70, "retorno", "info", `Defina o próximo contato: ${o.name}`, `${o.stage} · sem data de retorno`, "funil", { ref: o.id });
    for (const p of waiting.filter((x) => x.valid_until && diffDays(t, x.valid_until) <= 3)) add(35, "proposta", "warn", `Proposta vence em breve: ${p.client}`, `${p.service} · validade ${p.valid_until}`, "propostas", { amount: p.value, ref: p.id, date: p.valid_until });
    for (const p of waiting.filter((x) => x.age_days >= 7).slice(0, 6)) add(45, "proposta", "info", `Acompanhar proposta: ${p.client}`, `${p.service} · enviada há ${p.age_days} dia(s) sem resposta`, "propostas", { amount: p.value, ref: p.id });
    for (const p of proposals.filter((x) => x.expired).slice(0, 4)) add(38, "proposta", "warn", `Proposta vencida: ${p.client}`, `${p.service} · validade era ${p.valid_until}`, "propostas", { amount: p.value, ref: p.id });
    for (const p of awaitingMaterials.slice(0, 6)) add(50, "material", "info", `Cobrar materiais: ${p.name ?? p.service}`, `${p.client} · projeto parado aguardando materiais`, "projetos", { ref: p.id });
    for (const p of inReview.slice(0, 6)) add(55, "aprovacao", "info", `Aguardando aprovação: ${p.name ?? p.service}`, `${p.client} · em revisão`, "projetos", { ref: p.id });
    actions.sort((a, b) => a.priority - b.priority || String(a.date ?? "").localeCompare(String(b.date ?? "")));

    res.json({
      period: range,
      hasPrevious: hasPrev,
      sold: { value: s1.value, count: s1.count, previous: s0.value, delta: pct(s1.value, s0.value) },
      received: { value: r1, previous: r0, delta: pct(r1, r0) },
      balance: { total: balance, overdue: { count: overdue.length, value: overdue.reduce((a, i) => a + i.remaining, 0) } },
      projection: { next30: projection, note: "Parcelas a vencer nos próximos 30 dias. É previsão, não receita recebida." },
      profit: ex.count > 0 ? { value: r1 - ex.value, expenses: ex.value } : { value: null, reason: "Registre as despesas do período para calcular o lucro." },
      recurring: { monthly: mrr, active: rec.length },
      projects: {
        active: projects.length, needAttention, late: lateProjects.map(brief), dueSoon: dueSoon.map(brief),
        awaitingMaterials: awaitingMaterials.map(brief), inReview: inReview.map(brief), pendingApprovals,
      },
      proposals: { waiting: waiting.length, waitingValue: waiting.reduce((a, p) => a + p.value, 0), items: proposals.slice(0, 10), expired: proposals.filter((p) => p.expired).length },
      funnel: { open: Number(oppSum.n), value: Number(oppSum.v), dueContacts: opps.filter((o) => o.next_contact && o.next_contact <= t).length },
      series,
      actions: actions.slice(0, 20),
      nextAction: actions[0] ?? null,
    });
  } catch (e) {
    if (Number.isInteger(e?.code)) return res.status(e.code).json({ error: e.message });
    console.error("[resumo]", e?.message ?? e);
    res.status(500).json({ error: "Não foi possível calcular o resumo." });
  }
});
