import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertCircle, ArrowRight, Plus, TrendingDown, TrendingUp } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { useApi } from "../useApi";
import { Badge, Card, Empty, PageHeader, Skeleton, Title } from "../ui";
import { addDays, brl, fmtDate, todayISO } from "../lib";
import { ClientModal, PaymentModal, ProjectModal, ProposalModal, type PageProps } from "./shared";

type Action = { kind: string; tone: "bad" | "warn" | "info"; title: string; detail: string; page: string; amount?: number };
type Brief = { id: number; name: string; client: string; stage: string; deadline: string | null };
type Summary = {
  period: { from: string; to: string; days: number };
  hasPrevious: boolean;
  sold: { value: number; count: number; previous: number; delta: number | null };
  received: { value: number; previous: number; delta: number | null };
  balance: { total: number; overdue: { count: number; value: number } };
  projection: { next30: number; note: string };
  profit: { value: number | null; expenses?: number; reason?: string };
  recurring: { monthly: number; active: number };
  projects: { active: number; needAttention: number; late: Brief[]; dueSoon: Brief[]; awaitingMaterials: Brief[]; inReview: Brief[]; pendingApprovals: { project_id: number; project: string; client: string; item: string }[] };
  proposals: { waiting: number; waitingValue: number; expired: number; items: { id: number; service: string; value: number; client: string; age_days: number; expired: boolean; valid_until: string | null }[] };
  funnel: { open: number; value: number; dueContacts: number };
  series: { month: string; sold: number; received: number }[];
  actions: Action[];
  nextAction: Action | null;
};

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const lastDayOf = (y: number, m: number) => new Date(y, m, 0).getDate();

/** Período escolhido nos filtros, convertido em datas válidas que a API aceita (no máximo 5 anos). */
function period(preset: string, from: string, to: string) {
  const t = todayISO();
  const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  switch (preset) {
    case "30d": return { from: addDays(t, -29), to: t };
    case "90d": return { from: addDays(t, -89), to: t };
    case "ano": return { from: `${y}-01-01`, to: `${y}-12-31` };
    case "tudo": return { from: addDays(t, -1825), to: t };
    case "custom": return { from: from || addDays(t, -29), to: to || t };
    default: return { from: `${y}-${String(m).padStart(2, "0")}-01`, to: `${y}-${String(m).padStart(2, "0")}-${lastDayOf(y, m)}` };
  }
}

const toneText = { bad: "text-rose-300", warn: "text-amber-300", info: "text-violet" } as const;

function Stat({ label, value, hint, tone, delta, hasPrevious }: { label: string; value: string; hint?: string; tone?: "good" | "bad" | "violet"; delta?: number | null; hasPrevious?: boolean }) {
  const color = tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-rose-300" : tone === "violet" ? "text-violet" : "text-slate-50";
  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold tracking-tight ${color}`}>{value}</p>
      {delta !== undefined && (
        <p className="mt-1 flex items-center gap-1 text-xs text-slate-400">
          {!hasPrevious || delta === null ? "Sem período anterior para comparar" : (
            <>
              {delta >= 0 ? <TrendingUp className="h-3.5 w-3.5 text-emerald-300" aria-hidden /> : <TrendingDown className="h-3.5 w-3.5 text-rose-300" aria-hidden />}
              <span className={delta >= 0 ? "text-emerald-300" : "text-rose-300"}>{delta >= 0 ? "+" : ""}{delta}%</span> vs período anterior
            </>
          )}
        </p>
      )}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export default function Overview({ go }: PageProps) {
  const { data, filters, run } = useStore();
  const [modal, setModal] = useState<"client" | "proposal" | "payment" | "project" | null>(null);
  const per = useMemo(() => period(filters.preset, filters.from, filters.to), [filters.preset, filters.from, filters.to]);
  const valid = per.from <= per.to;
  const { data: s, error, loading, reload } = useApi<Summary>(valid ? `summary?from=${per.from}&to=${per.to}` : null);
  const isEmpty = !data?.clients.length && !data?.proposals.length;

  const header = (
    <PageHeader title="Visão geral" sub="Resumo da sua operação de sites e lojas virtuais">
      <button className="btn" onClick={() => setModal("client")}><Plus className="h-4 w-4" /> Novo cliente</button>
      <button className="btn" onClick={() => setModal("project")}><Plus className="h-4 w-4" /> Novo projeto</button>
      <button className="btn" onClick={() => setModal("payment")}>Registrar pagamento</button>
      <button className="btn btn-primary" onClick={() => setModal("proposal")}><Plus className="h-4 w-4" /> Nova proposta</button>
    </PageHeader>
  );
  const modals = (
    <>
      {modal === "client" && <ClientModal onClose={() => { setModal(null); void reload(); }} />}
      {modal === "proposal" && <ProposalModal onClose={() => { setModal(null); void reload(); }} />}
      {modal === "project" && <ProjectModal onClose={() => { setModal(null); void reload(); }} />}
      {modal === "payment" && <PaymentModal onClose={() => { setModal(null); void reload(); }} />}
    </>
  );

  if (!valid) return <>{header}<Card><Empty title="Período inválido" text="A data inicial precisa ser anterior à data final." /></Card>{modals}</>;
  if (error && !s) return <>{header}<Card><div className="p-6 text-center"><p className="mb-3 text-rose-300" role="alert">{error}</p><button className="btn btn-primary" onClick={() => void reload()}>Tentar novamente</button></div></Card>{modals}</>;
  if (!s) return <>{header}<div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true">{[0, 1, 2, 3].map((i) => <Skeleton key={i} />)}</div><Skeleton className="mt-4 h-64" />{modals}</>;

  const series = s.series.map((m) => ({ label: monthLabel(m.month), vendido: m.sold / 100, recebido: m.received / 100 }));
  const label = `${fmtDate(s.period.from)} a ${fmtDate(s.period.to)}`;
  const profitTone = s.profit.value === null ? undefined : s.profit.value >= 0 ? "good" : "bad";

  return (
    <div aria-busy={loading}>
      {header}

      {isEmpty && (
        <Card className="mb-5">
          <Empty title="Seu painel está vazio" text="Cadastre seu primeiro cliente ou carregue dados de exemplo para conhecer o painel. Você pode removê-los quando quiser em Configurações."
            action={<button className="btn btn-primary" onClick={() => void run(() => api.post("demo"), "Dados de exemplo carregados").then(() => reload())}>Carregar dados de exemplo</button>} />
        </Card>
      )}

      {s.nextAction && (
        <section aria-label="Sua próxima ação" className="glass mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-violet/30 p-4">
          <AlertCircle className={`h-5 w-5 shrink-0 ${toneText[s.nextAction.tone]}`} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wide text-slate-400">Sua próxima ação</p>
            <p className="font-semibold">{s.nextAction.title}{s.nextAction.amount ? ` · ${brl(s.nextAction.amount)}` : ""}</p>
            <p className="text-sm text-slate-400">{s.nextAction.detail}</p>
          </div>
          <button className="btn btn-primary" onClick={() => go(s.nextAction!.page)}>Resolver <ArrowRight className="h-4 w-4" /></button>
        </section>
      )}

      <p className="mb-2 text-xs text-slate-500">Período: {label}</p>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Indicadores do período">
        <Stat label="Vendi" value={brl(s.sold.value)} hint={`${s.sold.count} contrato(s) aprovado(s)`} tone="violet" delta={s.sold.delta} hasPrevious={s.hasPrevious} />
        <Stat label="Recebi" value={brl(s.received.value)} hint="Pagamentos confirmados, já descontados estornos" tone="good" delta={s.received.delta} hasPrevious={s.hasPrevious} />
        <Stat label="Falta receber" value={brl(s.balance.total)} hint={s.balance.overdue.count ? `${brl(s.balance.overdue.value)} atrasados (${s.balance.overdue.count})` : "Nada atrasado"} tone={s.balance.overdue.count ? "bad" : undefined} />
        <Stat label="Projetos que pedem atenção" value={String(s.projects.needAttention)} hint={`${s.projects.active} ativo(s)`} tone={s.projects.needAttention ? "bad" : undefined} />
        <Stat label="Previsão (30 dias)" value={brl(s.projection.next30)} hint="Previsão: parcelas a vencer, ainda não recebidas" />
        <Stat label="Lucro do período" value={s.profit.value === null ? "—" : brl(s.profit.value)} hint={s.profit.value === null ? s.profit.reason : `Recebido menos ${brl(s.profit.expenses ?? 0)} de despesas`} tone={profitTone} />
        <Stat label="Receita recorrente mensal" value={brl(s.recurring.monthly)} hint={`${s.recurring.active} contrato(s) ativo(s)`} />
        <Stat label="Funil de vendas" value={String(s.funnel.open)} hint={`${brl(s.funnel.value)} em aberto · ${s.funnel.dueContacts} retorno(s) devido(s)`} />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <Title>Vendido x recebido (6 meses)</Title>
          <div role="img" aria-label={`Gráfico de barras com valores vendidos e recebidos por mês: ${s.series.map((m) => `${monthLabel(m.month)} vendido ${brl(m.sold)}, recebido ${brl(m.received)}`).join("; ")}`}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={series} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.07)" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : String(v))} />
                <Tooltip cursor={{ fill: "rgba(255,255,255,.04)" }} contentStyle={{ background: "#14141d", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12 }} formatter={(v) => brl(Math.round(Number(v) * 100))} />
                <Legend iconType="circle" />
                <Bar dataKey="vendido" name="Vendido" fill="#b69cff" radius={[6, 6, 0, 0]} />
                <Bar dataKey="recebido" name="Recebido" fill="#4ade80" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <Title>Central de ações</Title>
          {!s.actions.length ? <Empty title="Tudo em dia" text="Nenhuma cobrança, entrega, retorno ou proposta pedindo atenção." /> : (
            <ul className="space-y-1">
              {s.actions.slice(0, 8).map((a, i) => (
                <li key={i}>
                  <button onClick={() => go(a.page)} className="flex w-full items-start gap-3 rounded-xl p-2 text-left hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet">
                    <AlertCircle className={`mt-0.5 h-4 w-4 shrink-0 ${toneText[a.tone]}`} aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-sm">{a.title}{a.amount ? ` · ${brl(a.amount)}` : ""}</span>
                      <span className="text-xs text-slate-500">{a.detail}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {s.actions.length > 8 && <p className="mt-2 text-xs text-slate-500">+ {s.actions.length - 8} ação(ões) menos urgentes.</p>}
        </Card>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <Title action={<button className="text-xs text-violet hover:underline" onClick={() => go("projetos")}>Ver projetos</button>}>Projetos que precisam de atenção</Title>
          {!s.projects.needAttention && !s.projects.dueSoon.length && !s.projects.pendingApprovals.length ? <Empty title="Nenhum projeto pedindo atenção" /> : (
            <ul className="space-y-2 text-sm">
              {s.projects.late.map((p) => <li key={`l${p.id}`} className="flex items-center justify-between gap-2"><span className="truncate">{p.name} <span className="text-slate-500">· {p.client}</span></span><Badge tone="bad">Atrasado desde {fmtDate(p.deadline)}</Badge></li>)}
              {s.projects.dueSoon.map((p) => <li key={`d${p.id}`} className="flex items-center justify-between gap-2"><span className="truncate">{p.name} <span className="text-slate-500">· {p.client}</span></span><Badge tone="warn">Entrega {fmtDate(p.deadline)}</Badge></li>)}
              {s.projects.awaitingMaterials.map((p) => <li key={`m${p.id}`} className="flex items-center justify-between gap-2"><span className="truncate">{p.name} <span className="text-slate-500">· {p.client}</span></span><Badge>Aguardando materiais</Badge></li>)}
              {s.projects.inReview.map((p) => <li key={`r${p.id}`} className="flex items-center justify-between gap-2"><span className="truncate">{p.name} <span className="text-slate-500">· {p.client}</span></span><Badge>Em revisão</Badge></li>)}
              {s.projects.pendingApprovals.map((a, i) => <li key={`a${i}`} className="flex items-center justify-between gap-2"><span className="truncate">{a.project} <span className="text-slate-500">· {a.item}</span></span><Badge tone="warn">Aprovação pendente</Badge></li>)}
            </ul>
          )}
        </Card>

        <Card>
          <Title action={<button className="text-xs text-violet hover:underline" onClick={() => go("propostas")}>Ver propostas</button>}>
            Propostas aguardando resposta
          </Title>
          {!s.proposals.items.length ? <Empty title="Nenhuma proposta aguardando" /> : (
            <>
              <p className="mb-2 text-sm text-slate-400">{s.proposals.waiting} válida(s) somando {brl(s.proposals.waitingValue)}{s.proposals.expired ? ` · ${s.proposals.expired} vencida(s)` : ""}</p>
              <ul className="space-y-2 text-sm">
                {s.proposals.items.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{p.client} <span className="text-slate-500">· {p.service} · há {p.age_days} dia(s)</span></span>
                    <span className="flex shrink-0 items-center gap-2">{p.expired && <Badge tone="warn">Vencida</Badge>}<b>{brl(p.value)}</b></span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </section>

      {modals}
    </div>
  );
}
