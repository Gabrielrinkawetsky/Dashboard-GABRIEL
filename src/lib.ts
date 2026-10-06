import type { Client, Data, Installment, Proposal, Recurring } from "./types";

export const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
// Data local em YYYY-MM-DD. Não use toISOString(): ele dá a data em UTC, que depois das 21h em Brasília já é o dia seguinte.
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// O CURRENT_TIMESTAMP do SQLite vem em UTC ("2026-10-06 00:30:00"); datas puras (YYYY-MM-DD) já são locais
export const localDay = (s: string) => (s.length > 10 ? ymd(new Date(s.replace(" ", "T") + "Z")) : s);
export const fmtDate = (iso?: string | null) => (iso ? localDay(iso).split("-").reverse().join("/") : "—");
export const todayISO = () => ymd(new Date());
export const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return ymd(d);
};
// Vírgula é o decimal (pt-BR). Sem vírgula, ponto com 1–2 dígitos no fim também é ("99.90", comum no celular);
// qualquer outro ponto separa milhar ("1.500").
export const toCents = (s: string) => {
  let t = s.replace(/[^\d.,-]/g, "");
  if (!t.includes(",")) t = t.replace(/\.(\d{1,2})$/, ",$1");
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
export const fromCents = (c: number) => (c / 100).toFixed(2).replace(".", ",");
export const clientLabel = (c?: Client) => (c ? (c.company ? `${c.company} (${c.name})` : c.name) : "—");

export type Preset = "mes" | "30d" | "90d" | "ano" | "tudo" | "custom";
export type Filters = { q: string; clientId: string; service: string; status: string; preset: Preset; from: string; to: string };
export const emptyFilters: Filters = { q: "", clientId: "", service: "", status: "", preset: "mes", from: "", to: "" };

export function range(f: Filters): { from: string; to: string } {
  const t = todayISO();
  switch (f.preset) {
    case "mes": return { from: t.slice(0, 8) + "01", to: t.slice(0, 7) + "-31" };
    case "30d": return { from: addDays(t, -29), to: t };
    case "90d": return { from: addDays(t, -89), to: t };
    case "ano": return { from: t.slice(0, 4) + "-01-01", to: t.slice(0, 4) + "-12-31" };
    case "custom": return { from: f.from || "0000-01-01", to: f.to || "9999-12-31" };
    default: return { from: "0000-01-01", to: "9999-12-31" };
  }
}

// Proposta enviada com validade vencida aparece como expirada
export const effStatus = (p: Proposal) => (p.status === "enviada" && p.valid_until && p.valid_until < todayISO() ? "expirada" : p.status);

export const instPaid = (d: Data, id: number) =>
  d.payments.filter((p) => p.installment_id === id).reduce((s, p) => s + (p.type === "refund" ? -p.amount : p.amount), 0);
export const instStatus = (d: Data, i: Installment) => {
  const paid = instPaid(d, i.id);
  if (paid >= i.amount) return "paga";
  if (i.due_date < todayISO()) return "atrasada";
  return paid > 0 ? "parcial" : "aberta";
};
export const recMonthly = (r: Recurring) => (r.period === "mensal" ? r.amount : r.period === "trimestral" ? r.amount / 3 : r.amount / 12);

export function scope(d: Data, f: Filters) {
  const cid = f.clientId ? Number(f.clientId) : null;
  const q = f.q.trim().toLowerCase();
  const client = new Map(d.clients.map((c) => [c.id, c]));
  const project = new Map(d.projects.map((p) => [p.id, p]));
  const proposal = new Map(d.proposals.map((p) => [p.id, p]));
  const svcOfInst = (i: Installment) =>
    (i.project_id && project.get(i.project_id)?.service) || (i.proposal_id && proposal.get(i.proposal_id)?.service) || "";
  const okClient = (id: number | null) => cid === null || id === cid;
  const okSvc = (s: string) => !f.service || s === f.service;
  const okQ = (...t: (string | null | undefined)[]) => !q || t.some((x) => x?.toLowerCase().includes(q));
  const cText = (id: number | null) => {
    const c = id ? client.get(id) : undefined;
    return [c?.name, c?.company];
  };
  return { cid, client, project, proposal, svcOfInst, okClient, okSvc, okQ, cText };
}

export function metrics(d: Data, f: Filters) {
  const s = scope(d, f);
  const { from, to } = range(f);
  const inP = (x?: string | null) => !!x && localDay(x) >= from && localDay(x) <= to;
  const today = todayISO();
  const net = (p: { type: string; amount: number }) => (p.type === "refund" ? -p.amount : p.amount);

  const props = d.proposals.filter((p) => s.okClient(p.client_id) && s.okSvc(p.service));
  const approvedList = props.filter((p) => p.status === "aprovada" && inP(p.decided_at));
  const sold = approvedList.reduce((a, p) => a + p.value, 0);
  const approved = approvedList.length;
  const refused = props.filter((p) => p.status === "recusada" && inP(p.decided_at)).length;
  const pending = props.filter((p) => effStatus(p) === "enviada");
  const conversion = approved + refused ? approved / (approved + refused) : null;

  const instScope = d.installments.filter((i) => s.okClient(i.client_id) && (!f.service || s.svcOfInst(i) === f.service));
  const instIds = new Set(instScope.map((i) => i.id));
  const contracted = instScope.reduce((a, i) => a + i.amount, 0);
  const receivedAll = d.payments.filter((p) => p.installment_id && instIds.has(p.installment_id)).reduce((a, p) => a + net(p), 0);
  const received = d.payments
    .filter((p) => inP(p.paid_at) && p.installment_id && instIds.has(p.installment_id))
    .reduce((a, p) => a + net(p), 0);
  const overdue = instScope.filter((i) => i.due_date < today && instPaid(d, i.id) < i.amount);
  const overdueSum = overdue.reduce((a, i) => a + i.amount - instPaid(d, i.id), 0);

  const projs = d.projects.filter((p) => s.okClient(p.client_id) && s.okSvc(p.service));
  const active = projs.filter((p) => !p.cancelled && p.stage !== "Entregue");
  const mrr = d.recurring.filter((r) => r.status === "ativo" && s.okClient(r.client_id)).reduce((a, r) => a + recMonthly(r), 0);

  const exps = d.expenses.filter((e) => {
    if (!inP(e.date)) return false;
    if (!f.clientId && !f.service) return true;
    const p = e.project_id ? s.project.get(e.project_id) : undefined;
    return !!p && s.okClient(p.client_id) && s.okSvc(p.service);
  });
  const expenseSum = exps.reduce((a, e) => a + e.amount, 0);
  // Lucro só aparece quando há despesas registradas no período
  const profit = exps.length ? received - expenseSum : null;

  return { sold, approved, refused, pending, conversion, contracted, receivedAll, balance: contracted - receivedAll, received, overdue, overdueSum, active, projs, mrr, exps, expenseSum, profit, instScope, from, to, inP, s };
}

// Vendido e recebido por mês (últimos n meses até o fim do período), respeitando cliente/serviço
export function monthlySeries(d: Data, f: Filters, months = 6) {
  const m = metrics(d, f);
  const end = m.to > todayISO() ? todayISO() : m.to;
  const out: { key: string; label: string; recebido: number; vendido: number }[] = [];
  const base = new Date(end.slice(0, 7) + "-01T12:00:00");
  for (let i = months - 1; i >= 0; i--) {
    const x = new Date(base);
    x.setMonth(x.getMonth() - i);
    out.push({ key: ymd(x).slice(0, 7), label: x.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""), recebido: 0, vendido: 0 });
  }
  const instIds = new Set(m.instScope.map((i) => i.id));
  for (const p of d.payments) {
    if (!p.installment_id || !instIds.has(p.installment_id)) continue;
    const row = out.find((o) => o.key === p.paid_at.slice(0, 7));
    if (row) row.recebido += (p.type === "refund" ? -p.amount : p.amount) / 100;
  }
  for (const p of d.proposals) {
    if (p.status !== "aprovada" || !p.decided_at || !m.s.okClient(p.client_id) || !m.s.okSvc(p.service)) continue;
    const row = out.find((o) => o.key === p.decided_at!.slice(0, 7));
    if (row) row.vendido += p.value / 100;
  }
  return out;
}

export type Task = { id: string; text: string; sub: string; tone: "bad" | "warn" | "info"; page: string };
export function dailyTasks(d: Data): Task[] {
  const t = todayISO(), soon = addDays(t, 3), out: Task[] = [];
  const cl = new Map(d.clients.map((c) => [c.id, c]));
  for (const i of d.installments) {
    if (instPaid(d, i.id) >= i.amount || i.due_date > t) continue;
    out.push({ id: `i${i.id}`, text: `Cobrar ${brl(i.amount - instPaid(d, i.id))} · ${clientLabel(cl.get(i.client_id))}`, sub: `${i.label ?? "Parcela"} ${i.due_date < t ? "venceu em" : "vence"} ${fmtDate(i.due_date)}`, tone: i.due_date < t ? "bad" : "warn", page: "financeiro" });
  }
  for (const p of d.projects) {
    if (p.cancelled || p.stage === "Entregue" || !p.deadline || p.deadline > t) continue;
    out.push({ id: `p${p.id}`, text: `Entrega: ${p.name ?? p.service}`, sub: p.deadline < t ? `Atrasado desde ${fmtDate(p.deadline)}` : "Prazo é hoje", tone: p.deadline < t ? "bad" : "warn", page: "projetos" });
  }
  for (const p of d.proposals) {
    if (p.status !== "enviada" || !p.valid_until || p.valid_until < t || p.valid_until > soon) continue;
    out.push({ id: `q${p.id}`, text: `Proposta expira em breve · ${clientLabel(cl.get(p.client_id))}`, sub: `Validade ${fmtDate(p.valid_until)}`, tone: "info", page: "propostas" });
  }
  for (const r of d.recurring) {
    if (r.status !== "ativo" || !r.next_due || r.next_due > soon) continue;
    out.push({ id: `r${r.id}`, text: `Recorrência: ${r.name}`, sub: `Cobrança em ${fmtDate(r.next_due)}`, tone: "info", page: "recorrencias" });
  }
  return out;
}
