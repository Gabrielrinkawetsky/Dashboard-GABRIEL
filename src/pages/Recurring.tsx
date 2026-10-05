import { useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { Badge, Card, Confirm, DemoTag, Empty, Field, Modal, MoneyInput, PageHeader, statusTone } from "../ui";
import { brl, clientLabel, fmtDate, recMonthly } from "../lib";
import type { Recurring } from "../types";
import { Kpi, type PageProps } from "./shared";

const KINDS = ["Manutenção", "Hospedagem", "Suporte", "Outro"];

function RecModal({ rec, onClose }: { rec?: Recurring; onClose: () => void }) {
  const { data, run } = useStore();
  const [f, setF] = useState({ client_id: String(rec?.client_id ?? ""), name: rec?.name ?? "", kind: rec?.kind ?? KINDS[0], amount: rec?.amount ?? 0, period: rec?.period ?? "mensal", status: rec?.status ?? "ativo", next_due: rec?.next_due ?? "" });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => (rec ? api.update("recurring", rec.id, f) : api.create("recurring", f)), rec ? "Contrato atualizado" : "Contrato criado")) onClose();
  };
  return (
    <Modal title={rec ? "Editar contrato" : "Novo contrato recorrente"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Cliente *">
          <select className="field" required value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })}>
            <option value="">Selecione…</option>{data!.clients.map((c) => <option key={c.id} value={c.id}>{clientLabel(c)}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome *"><input className="field" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Tipo"><select className="field" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor (R$) *"><MoneyInput cents={f.amount} required onChange={(amount) => setF({ ...f, amount })} /></Field>
          <Field label="Periodicidade"><select className="field" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value as Recurring["period"] })}>{["mensal", "trimestral", "anual"].map((k) => <option key={k}>{k}</option>)}</select></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Situação"><select className="field" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Recurring["status"] })}>{["ativo", "pausado", "cancelado"].map((k) => <option key={k}>{k}</option>)}</select></Field>
          <Field label="Próxima cobrança"><input className="field" type="date" value={f.next_due} onChange={(e) => setF({ ...f, next_due: e.target.value })} /></Field>
        </div>
        <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary">Salvar</button></div>
      </form>
    </Modal>
  );
}

export default function RecurringPage(_: PageProps) {
  const { data, filters, run } = useStore();
  const d = data!;
  const [edit, setEdit] = useState<Recurring | "new" | null>(null);
  const [del, setDel] = useState<Recurring | null>(null);
  const clients = new Map(d.clients.map((c) => [c.id, c]));
  const q = filters.q.trim().toLowerCase();
  const list = d.recurring.filter((r) => {
    if (filters.clientId && String(r.client_id) !== filters.clientId) return false;
    if (filters.status && r.status !== filters.status) return false;
    const c = clients.get(r.client_id);
    return !q || [c?.name, c?.company, r.name, r.kind].some((x) => x?.toLowerCase().includes(q));
  });
  const active = list.filter((r) => r.status === "ativo");
  const mrr = active.reduce((a, r) => a + recMonthly(r), 0);

  return (
    <>
      <PageHeader title="Recorrências" sub="Manutenção, hospedagem e suporte">
        <button className="btn btn-primary" onClick={() => setEdit("new")}><Plus className="h-4 w-4" /> Novo contrato</button>
      </PageHeader>
      <section className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="Receita recorrente mensal" value={brl(mrr)} tone="good" />
        <Kpi label="Projeção anual" value={brl(mrr * 12)} />
        <Kpi label="Contratos ativos" value={String(active.length)} />
      </section>
      <Card>
        {!list.length ? <Empty title="Nenhum contrato recorrente" text="Cadastre manutenção, hospedagem ou suporte para acompanhar a receita mensal." action={<button className="btn btn-primary" onClick={() => setEdit("new")}>Novo contrato</button>} /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="th">Contrato</th><th className="th">Cliente</th><th className="th text-right">Valor</th><th className="th">Periodicidade</th><th className="th">Próxima cobrança</th><th className="th">Situação</th><th className="th" /></tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id}>
                    <td className="td"><span className="mr-2 font-medium">{r.name}</span>{r.demo ? <DemoTag /> : null}<div className="text-xs text-slate-500">{r.kind}</div></td>
                    <td className="td">{clientLabel(clients.get(r.client_id))}</td>
                    <td className="td text-right">{brl(r.amount)}</td>
                    <td className="td capitalize">{r.period}</td>
                    <td className="td">{fmtDate(r.next_due)}</td>
                    <td className="td"><Badge tone={statusTone[r.status] as never}>{r.status}</Badge></td>
                    <td className="td whitespace-nowrap text-right">
                      <button className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10" aria-label="Editar" onClick={() => setEdit(r)}><Pencil className="h-4 w-4" /></button>
                      <button className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10" aria-label="Excluir" onClick={() => setDel(r)}><Trash2 className="h-4 w-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {edit && <RecModal rec={edit === "new" ? undefined : edit} onClose={() => setEdit(null)} />}
      {del && <Confirm text={`Excluir o contrato "${del.name}"?`} onNo={() => setDel(null)} onYes={() => { void run(() => api.remove("recurring", del.id), "Contrato excluído"); setDel(null); }} />}
    </>
  );
}
