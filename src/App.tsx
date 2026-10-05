import { useMemo, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { pedidos } from "./data";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const periodos = [7, 15, 30] as const;

const badge = {
  Pago: "bg-emerald-100 text-emerald-700",
  Pendente: "bg-amber-100 text-amber-700",
  Cancelado: "bg-rose-100 text-rose-700",
};

export default function App() {
  const [dias, setDias] = useState<number>(30);

  const lista = useMemo(() => {
    const max = pedidos.reduce((m, p) => (p.data > m ? p.data : m), "");
    const corte = new Date(max);
    corte.setDate(corte.getDate() - dias + 1);
    const c = corte.toISOString().slice(0, 10);
    return pedidos.filter((p) => p.data >= c);
  }, [dias]);

  const pagos = lista.filter((p) => p.status === "Pago");
  const receita = pagos.reduce((s, p) => s + p.valor, 0);

  const porDia = useMemo(() => {
    const m = new Map<string, number>();
    pagos.forEach((p) => m.set(p.data, (m.get(p.data) ?? 0) + p.valor));
    return [...m].sort().map(([data, valor]) => ({ data: data.slice(5).split("-").reverse().join("/"), valor }));
  }, [pagos]);

  const porProduto = useMemo(() => {
    const m = new Map<string, number>();
    pagos.forEach((p) => m.set(p.produto, (m.get(p.produto) ?? 0) + p.valor));
    return [...m].map(([produto, valor]) => ({ produto, valor })).sort((a, b) => b.valor - a.valor);
  }, [pagos]);

  const kpis = [
    { label: "Receita", value: brl(receita) },
    { label: "Pedidos", value: String(lista.length) },
    { label: "Ticket médio", value: brl(pagos.length ? receita / pagos.length : 0) },
    { label: "Pendentes", value: String(lista.filter((p) => p.status === "Pendente").length) },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Dashboard de Vendas</h1>
        <div className="flex gap-1 rounded-lg bg-white p-1 shadow-sm">
          {periodos.map((d) => (
            <button
              key={d}
              onClick={() => setDias(d)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                dias === d ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {d} dias
            </button>
          ))}
        </div>
      </header>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">{k.label}</p>
            <p className="mt-1 text-2xl font-semibold">{k.value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold">Receita por dia</h2>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={porDia}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="data" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip formatter={(v) => brl(Number(v))} />
              <Area dataKey="valor" stroke="#0f172a" fill="#cbd5e1" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold">Receita por produto</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={porProduto}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="produto" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip formatter={(v) => brl(Number(v))} />
              <Bar dataKey="valor" fill="#0f172a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="overflow-x-auto rounded-xl bg-white p-4 shadow-sm">
        <h2 className="mb-3 font-semibold">Últimos pedidos</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              {["Pedido", "Cliente", "Produto", "Data", "Valor", "Status"].map((h) => (
                <th key={h} className="pb-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...lista].sort((a, b) => b.data.localeCompare(a.data)).slice(0, 10).map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="py-2">{p.id}</td>
                <td>{p.cliente}</td>
                <td>{p.produto}</td>
                <td>{p.data.split("-").reverse().join("/")}</td>
                <td>{brl(p.valor)}</td>
                <td>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge[p.status]}`}>{p.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
