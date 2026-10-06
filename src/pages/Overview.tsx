import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertCircle, CalendarClock, Plus } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { Badge, Card, Empty, PageHeader, Title } from "../ui";
import { brl, clientLabel, dailyTasks, fmtDate, instPaid, metrics, monthlySeries, todayISO } from "../lib";
import { ClientModal, Kpi, PaymentModal, ProjectModal, ProposalModal, type PageProps } from "./shared";

const periodLabel: Record<string, string> = { mes: "no mês", "30d": "em 30 dias", "90d": "em 90 dias", ano: "no ano", tudo: "no total", custom: "no período" };

export default function Overview({ go }: PageProps) {
  const { data, filters, run } = useStore();
  const d = data!;
  const [modal, setModal] = useState<"client" | "proposal" | "payment" | "project" | null>(null);
  const m = metrics(d, filters);
  const series = monthlySeries(d, filters);
  const tasks = dailyTasks(d);
  const per = periodLabel[filters.preset];
  const clients = new Map(d.clients.map((c) => [c.id, c]));
  const upcoming = m.instScope
    .filter((i) => instPaid(d, i.id) < i.amount)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, 6);
  const isEmpty = !d.clients.length && !d.proposals.length;

  return (
    <>
      <PageHeader title="Visão geral" sub="Resumo da sua operação de sites e lojas virtuais">
        <button className="btn" onClick={() => setModal("client")}><Plus className="h-4 w-4" /> Novo cliente</button>
        <button className="btn" onClick={() => setModal("project")}><Plus className="h-4 w-4" /> Novo projeto</button>
        <button className="btn" onClick={() => setModal("payment")}>Registrar pagamento</button>
        <button className="btn btn-primary" onClick={() => setModal("proposal")}><Plus className="h-4 w-4" /> Nova proposta</button>
      </PageHeader>

      {isEmpty && (
        <Card className="mb-5">
          <Empty title="Seu painel está vazio" text="Cadastre seu primeiro cliente ou carregue dados de exemplo para conhecer o painel. Você pode removê-los quando quiser em Configurações."
            action={<button className="btn btn-primary" onClick={() => void run(() => api.post("demo"), "Dados de exemplo carregados")}>Carregar dados de exemplo</button>} />
        </Card>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={`Valor vendido ${per}`} value={brl(m.sold)} hint={`${m.approved} contrato(s) aprovado(s)`} tone="violet" />
        <Kpi label={`Valor recebido ${per}`} value={brl(m.received)} tone="good" />
        <Kpi label="Saldo a receber" value={brl(Math.max(0, m.balance))} hint={`de ${brl(m.contracted)} contratados`} />
        <Kpi label="Pagamentos atrasados" value={brl(m.overdueSum)} hint={`${m.overdue.length} parcela(s)`} tone={m.overdue.length ? "bad" : undefined} />
        <Kpi label="Projetos ativos" value={String(m.active.length)} />
        <Kpi label="Propostas pendentes" value={String(m.pending.length)} hint={brl(m.pending.reduce((a, p) => a + p.value, 0))} />
        <Kpi label={`Conversão ${per}`} value={m.conversion === null ? "—" : `${Math.round(m.conversion * 100)}%`} hint={m.conversion === null ? "Sem propostas decididas" : `${m.approved} aprovadas · ${m.refused} recusadas`} />
        <Kpi label="Receita recorrente mensal" value={brl(m.mrr)} />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <Title action={<span className="text-xs text-slate-500">
            Lucro {per}: <b className={m.profit === null ? "" : m.profit >= 0 ? "text-emerald-300" : "text-rose-300"}>{m.profit === null ? "— (registre despesas)" : brl(m.profit)}</b>
          </span>}>Vendido x recebido (6 meses)</Title>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={series} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.07)" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickLine={false} axisLine={false} fontSize={12} tickFormatter={(v) => `${v / 1000}k`} />
              <Tooltip cursor={{ fill: "rgba(255,255,255,.04)" }} contentStyle={{ background: "#14141d", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12 }} formatter={(v) => brl(Number(v) * 100)} />
              <Legend iconType="circle" />
              <Bar dataKey="vendido" name="Vendido" fill="#b69cff" radius={[6, 6, 0, 0]} />
              <Bar dataKey="recebido" name="Recebido" fill="#4ade80" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <Title>Tarefas do dia</Title>
          {!tasks.length ? <Empty title="Tudo em dia" text="Nenhuma cobrança, entrega ou vencimento próximo." /> : (
            <ul className="space-y-2">
              {tasks.slice(0, 7).map((t) => (
                <li key={t.id}>
                  <button onClick={() => go(t.page)} className="flex w-full items-start gap-3 rounded-xl p-2 text-left hover:bg-white/5">
                    <AlertCircle className={`mt-0.5 h-4 w-4 shrink-0 ${t.tone === "bad" ? "text-rose-300" : t.tone === "warn" ? "text-amber-300" : "text-violet"}`} />
                    <span><span className="block text-sm">{t.text}</span><span className="text-xs text-slate-500">{t.sub}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <Card className="mt-4">
        <Title action={<button className="text-xs text-violet hover:underline" onClick={() => go("financeiro")}>Ver financeiro</button>}>
          <span className="inline-flex items-center gap-2"><CalendarClock className="h-4 w-4" /> Próximos vencimentos</span>
        </Title>
        {!upcoming.length ? <Empty title="Nenhum vencimento em aberto" /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="th">Cliente</th><th className="th">Parcela</th><th className="th">Vencimento</th><th className="th text-right">A receber</th><th className="th" /></tr></thead>
              <tbody>
                {upcoming.map((i) => (
                  <tr key={i.id}>
                    <td className="td">{clientLabel(clients.get(i.client_id))}</td>
                    <td className="td">{i.label}</td>
                    <td className="td">{fmtDate(i.due_date)}</td>
                    <td className="td text-right font-medium">{brl(i.amount - instPaid(d, i.id))}</td>
                    <td className="td">{i.due_date < todayISO() &&<Badge tone="bad">Atrasada</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {modal === "client" && <ClientModal onClose={() => setModal(null)} />}
      {modal === "proposal" && <ProposalModal onClose={() => setModal(null)} />}
      {modal === "project" && <ProjectModal onClose={() => setModal(null)} />}
      {modal === "payment" && <PaymentModal onClose={() => setModal(null)} />}
    </>
  );
}
