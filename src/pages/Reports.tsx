import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useStore } from "../store";
import { Badge, Card, Empty, PageHeader, Title } from "../ui";
import { brl, clientLabel, fmtDate, instPaid, metrics, monthlySeries, todayISO } from "../lib";
import { Kpi, type PageProps } from "./shared";

const tip = { contentStyle: { background: "#14141d", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12 }, cursor: { fill: "rgba(255,255,255,.04)" } };
const COLORS = ["#b69cff", "#9b7bff", "#4ade80", "#fbbf24", "#fb7185"];

export default function Reports(_: PageProps) {
  const { data, filters } = useStore();
  const d = data!;
  const m = metrics(d, filters);
  const series = monthlySeries(d, filters, 12);
  const clients = new Map(d.clients.map((c) => [c.id, c]));

  // Vendas por serviço no período
  const bySvc = new Map<string, number>();
  d.proposals.filter((p) => p.status === "aprovada" && m.inP(p.decided_at) && m.s.okClient(p.client_id) && m.s.okSvc(p.service))
    .forEach((p) => bySvc.set(p.service, (bySvc.get(p.service) ?? 0) + p.value / 100));
  const svcData = [...bySvc].map(([service, valor]) => ({ service, valor })).sort((a, b) => b.valor - a.valor);

  const inRange = d.proposals.filter((p) => m.inP(p.created_at) && m.s.okClient(p.client_id) && m.s.okSvc(p.service));
  const funnel = [
    ["Enviadas", inRange.filter((p) => p.status !== "rascunho").length],
    ["Aprovadas", m.approved],
    ["Recusadas", m.refused],
    ["Pendentes", m.pending.length],
  ] as const;
  const late = [...m.overdue].sort((a, b) => a.due_date.localeCompare(b.due_date));
  const hasData = d.proposals.length || d.payments.length;

  return (
    <>
      <PageHeader title="Relatórios" sub="Mesmos filtros do restante do painel" />
      {!hasData ? <Card><Empty title="Sem dados para relatórios" text="Cadastre propostas e pagamentos, ou carregue os dados de exemplo em Configurações." /></Card> : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Vendido no período" value={brl(m.sold)} tone="violet" />
            <Kpi label="Recebido no período" value={brl(m.received)} tone="good" />
            <Kpi label="Conversão" value={m.conversion === null ? "—" : `${Math.round(m.conversion * 100)}%`} hint="aprovadas ÷ decididas" />
            <Kpi label="Em atraso" value={brl(m.overdueSum)} tone={m.overdue.length ? "bad" : undefined} />
          </section>

          <section className="mt-4 grid gap-4 xl:grid-cols-2">
            <Card>
              <Title>Receita recebida por mês</Title>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={series}>
                  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#b69cff" stopOpacity={0.5} /><stop offset="100%" stopColor="#b69cff" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.07)" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} />
                  <Tooltip {...tip} formatter={(v) => brl(Number(v) * 100)} />
                  <Area dataKey="recebido" name="Recebido" stroke="#b69cff" strokeWidth={2} fill="url(#g)" />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
            <Card>
              <Title>Vendas por serviço</Title>
              {!svcData.length ? <Empty title="Nenhuma venda no período" /> : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={svcData} layout="vertical" margin={{ left: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.07)" horizontal={false} />
                    <XAxis type="number" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis type="category" dataKey="service" tickLine={false} axisLine={false} fontSize={12} width={120} />
                    <Tooltip {...tip} formatter={(v) => brl(Number(v) * 100)} />
                    <Bar dataKey="valor" name="Vendido" radius={[0, 6, 6, 0]}>{svcData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>
          </section>

          <section className="mt-4 grid gap-4 xl:grid-cols-2">
            <Card>
              <Title>Conversão de propostas</Title>
              <ul className="space-y-3">
                {funnel.map(([label, n], i) => (
                  <li key={label}>
                    <div className="mb-1 flex justify-between text-sm"><span>{label}</span><b>{n}</b></div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full" style={{ width: `${funnel[0][1] ? (n / funnel[0][1]) * 100 : 0}%`, background: COLORS[i] }} /></div>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-slate-500">Taxa de conversão = aprovadas ÷ (aprovadas + recusadas) decididas no período.</p>
            </Card>
            <Card>
              <Title>Pagamentos em atraso</Title>
              {!late.length ? <Empty title="Nenhum pagamento em atraso" /> : (
                <ul className="divide-y divide-white/5">
                  {late.map((i) => {
                    const days = Math.round((Date.parse(todayISO()) - Date.parse(i.due_date)) / 864e5);
                    return (
                      <li key={i.id} className="flex items-center justify-between py-2 text-sm">
                        <div>{clientLabel(clients.get(i.client_id))}<div className="text-xs text-slate-500">{i.label} · venceu em {fmtDate(i.due_date)}</div></div>
                        <div className="text-right"><b className="text-rose-300">{brl(i.amount - instPaid(d, i.id))}</b><div><Badge tone="bad">{days} dia(s)</Badge></div></div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </section>
        </>
      )}
    </>
  );
}
