import { useState, type FormEvent } from "react";
import { Copy, ExternalLink, Plus, RefreshCw, Send, Trash2, X } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { Badge, Card, DemoTag, Empty, Field, Modal, MoneyInput, PageHeader, statusTone, Title } from "../ui";
import { brl, clientLabel, fmtDate, instPaid, instStatus, metrics, range, todayISO } from "../lib";
import { Kpi, PaymentModal, type PageProps } from "./shared";
import type { Installment } from "../types";

function ExpenseModal({ onClose }: { onClose: () => void }) {
  const { data, run } = useStore();
  const [f, setF] = useState({ description: "", amount: 0, date: todayISO(), project_id: "" });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api.create("expenses", f), "Despesa registrada")) onClose();
  };
  return (
    <Modal title="Nova despesa" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Descrição *"><input className="field" required value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor (R$) *"><MoneyInput cents={f.amount} required onChange={(amount) => setF({ ...f, amount })} /></Field>
          <Field label="Data *"><input className="field" type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        </div>
        <Field label="Projeto (opcional)">
          <select className="field" value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}>
            <option value="">Despesa geral</option>
            {data!.projects.map((p) => <option key={p.id} value={p.id}>{p.name ?? p.service}</option>)}
          </select>
        </Field>
        <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary">Salvar</button></div>
      </form>
    </Modal>
  );
}

function ChargeModal({ onClose }: { onClose: () => void }) {
  const { data, run } = useStore();
  const [f, setF] = useState({ client_id: "", label: "", amount: 0, due_date: todayISO(), project_id: "" });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api.post("installments", f), "Cobrança criada")) onClose();
  };
  return (
    <Modal title="Cobrança avulsa" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Cliente *">
          <select className="field" required value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value, project_id: "" })}>
            <option value="">Selecione…</option>{data!.clients.map((c) => <option key={c.id} value={c.id}>{clientLabel(c)}</option>)}
          </select>
        </Field>
        <Field label="Projeto (opcional)">
          <select className="field" value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}>
            <option value="">—</option>{data!.projects.filter((p) => String(p.client_id) === f.client_id).map((p) => <option key={p.id} value={p.id}>{p.name ?? p.service}</option>)}
          </select>
        </Field>
        <Field label="Descrição"><input className="field" value={f.label} placeholder="Ex.: Ajuste extra de layout" onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor (R$) *"><MoneyInput cents={f.amount} required onChange={(amount) => setF({ ...f, amount })} /></Field>
          <Field label="Vencimento *"><input className="field" type="date" required value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
        </div>
        <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary">Criar cobrança</button></div>
      </form>
    </Modal>
  );
}

const ASAAS_STATUS: Record<string, string> = {
  PENDING: "aguardando pagamento", OVERDUE: "vencida no Asaas", CONFIRMED: "confirmada", RECEIVED: "recebida",
  RECEIVED_IN_CASH: "recebida em dinheiro", REFUNDED: "estornada", DELETED: "excluída no Asaas",
};

/** Cobrança da parcela no Asaas: criar, abrir/copiar o link, atualizar o status e cancelar. */
function AsaasActions({ inst, paid }: { inst: Installment; paid: boolean }) {
  const { run, notify } = useStore();
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>, ok?: string) => { setBusy(true); await run(fn, ok); setBusy(false); };
  const copy = (url: string) => navigator.clipboard.writeText(url).then(() => notify("ok", "Link de pagamento copiado"), () => notify("err", "Não foi possível copiar"));
  const id = inst.asaas_payment_id;
  if (!id) {
    if (paid) return null;
    return (
      <button className="btn !px-2.5 !py-1" disabled={busy} title="Criar cobrança (PIX, boleto ou cartão) no Asaas"
        onClick={() => void act(async () => { const r = await api.asaasCharge(inst.id); if (r.invoiceUrl) await copy(r.invoiceUrl); }, "Cobrança criada no Asaas")}>
        <Send className="h-3.5 w-3.5" /> {busy ? "Criando…" : "Cobrar no Asaas"}
      </button>
    );
  }
  if (id.startsWith("pendente-")) return <span className="text-xs text-slate-500">Criando no Asaas…</span>;
  const icon = "btn !px-2 !py-1";
  return (
    <div className="flex items-center justify-end gap-1">
      <span className="mr-1 text-xs text-slate-400">{ASAAS_STATUS[inst.asaas_status ?? ""] ?? inst.asaas_status ?? "Asaas"}</span>
      {inst.asaas_invoice_url && <>
        <a className={icon} href={inst.asaas_invoice_url} target="_blank" rel="noopener noreferrer" aria-label="Abrir link de pagamento" title="Abrir link de pagamento"><ExternalLink className="h-3.5 w-3.5" /></a>
        <button className={icon} aria-label="Copiar link de pagamento" title="Copiar link de pagamento" onClick={() => void copy(inst.asaas_invoice_url!)}><Copy className="h-3.5 w-3.5" /></button>
      </>}
      <button className={icon} disabled={busy} aria-label="Atualizar status pelo Asaas" title="Atualizar status pelo Asaas" onClick={() => void act(() => api.asaasSync(inst.id), "Status atualizado")}><RefreshCw className="h-3.5 w-3.5" /></button>
      {!paid && <button className={icon} disabled={busy} aria-label="Cancelar cobrança no Asaas" title="Cancelar cobrança no Asaas"
        onClick={() => { if (confirm("Cancelar esta cobrança no Asaas? O link deixa de funcionar.")) void act(() => api.asaasCancel(inst.id), "Cobrança cancelada no Asaas"); }}><X className="h-3.5 w-3.5" /></button>}
    </div>
  );
}

export default function Finance(_: PageProps) {
  const { data, filters, run } = useStore();
  const d = data!;
  const m = metrics(d, filters);
  const [pay, setPay] = useState<number | null | "new">(null);
  const [modal, setModal] = useState<"expense" | "charge" | null>(null);
  const clients = new Map(d.clients.map((c) => [c.id, c]));
  const q = filters.q.trim().toLowerCase();
  const { from, to } = range(filters);
  const instById = new Map(d.installments.map((i) => [i.id, i]));

  const rows = m.instScope.filter((i) => {
    if (filters.status && instStatus(d, i) !== filters.status) return false;
    const c = clients.get(i.client_id);
    return !q || [c?.name, c?.company, i.label].some((x) => x?.toLowerCase().includes(q));
  });
  const moves = d.payments.filter((p) => {
    if (filters.clientId && String(p.client_id) !== filters.clientId) return false;
    if (filters.service && !(p.installment_id && m.instScope.some((i) => i.id === p.installment_id))) return false;
    if (p.paid_at < from || p.paid_at > to) return false;
    const c = p.client_id ? clients.get(p.client_id) : undefined;
    return !q || [c?.name, c?.company, p.note].some((x) => x?.toLowerCase().includes(q));
  });

  return (
    <>
      <PageHeader title="Financeiro" sub="Contratado, recebido e a receber">
        <button className="btn" onClick={() => setModal("expense")}>Nova despesa</button>
        <button className="btn" onClick={() => setModal("charge")}><Plus className="h-4 w-4" /> Cobrança avulsa</button>
        <button className="btn btn-primary" onClick={() => setPay("new")}>Registrar pagamento</button>
      </PageHeader>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Valor contratado" value={brl(m.contracted)} tone="violet" />
        <Kpi label="Total recebido" value={brl(m.receivedAll)} tone="good" />
        <Kpi label="Saldo a receber" value={brl(Math.max(0, m.balance))} hint={m.overdue.length ? `${brl(m.overdueSum)} em atraso` : undefined} tone={m.overdue.length ? "bad" : undefined} />
        <Kpi label="Despesas no período" value={brl(m.expenseSum)} hint={m.profit === null ? "Lucro indisponível: sem despesas registradas" : `Lucro: ${brl(m.profit)}`} />
      </section>

      <Card className="mt-4">
        <Title>Parcelas</Title>
        {!rows.length ? <Empty title="Nenhuma parcela" text="Parcelas são criadas ao aprovar uma proposta ou em “Cobrança avulsa”." /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="th">Cliente</th><th className="th">Parcela</th><th className="th">Vencimento</th><th className="th text-right">Valor</th><th className="th text-right">Pago</th><th className="th">Status</th><th className="th" /></tr></thead>
              <tbody>
                {rows.map((i) => {
                  const st = instStatus(d, i), paid = instPaid(d, i.id);
                  return (
                    <tr key={i.id}>
                      <td className="td"><span className="mr-2">{clientLabel(clients.get(i.client_id))}</span>{i.demo ? <DemoTag /> : null}</td>
                      <td className="td">{i.label}</td>
                      <td className="td">{fmtDate(i.due_date)}</td>
                      <td className="td text-right">{brl(i.amount)}</td>
                      <td className="td text-right text-emerald-300">{brl(paid)}</td>
                      <td className="td"><Badge tone={statusTone[st] as never}>{st}</Badge></td>
                      <td className="td text-right">
                        <div className="flex items-center justify-end gap-2">
                          {d.integration.asaas.configured && <AsaasActions inst={i} paid={st === "paga"} />}
                          {st !== "paga" && <button className="btn !px-2.5 !py-1" onClick={() => setPay(i.id)}>Registrar</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <section className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <Title>Movimentações (origem e histórico)</Title>
          {!moves.length ? <Empty title="Sem movimentações no período" /> : (
            <ul className="max-h-80 divide-y divide-white/5 overflow-y-auto">
              {moves.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <div>
                    <div>{clientLabel(p.client_id ? clients.get(p.client_id) : undefined)} <span className="text-slate-500">· {instById.get(p.installment_id ?? -1)?.label}</span></div>
                    <div className="text-xs text-slate-500">{fmtDate(p.paid_at)} · {p.source === "manual" ? "Lançamento manual" : `Integração (${p.source})`}{p.note ? ` · ${p.note}` : ""}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <b className={p.type === "refund" ? "text-rose-300" : "text-emerald-300"}>{p.type === "refund" ? "−" : "+"}{brl(p.amount)}</b>
                    {p.source === "manual" && <button aria-label="Excluir lançamento" className="text-slate-500 hover:text-rose-300" onClick={() => { if (confirm("Excluir este lançamento manual?")) void run(() => api.del(`payments/${p.id}`), "Lançamento excluído"); }}><Trash2 className="h-4 w-4" /></button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <Title>Despesas</Title>
          {!m.exps.length ? <Empty title="Nenhuma despesa no período" text="Registre despesas para o painel calcular o lucro." /> : (
            <ul className="max-h-80 divide-y divide-white/5 overflow-y-auto">
              {m.exps.map((e) => (
                <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                  <div>{e.description}<div className="text-xs text-slate-500">{fmtDate(e.date)}</div></div>
                  <div className="flex items-center gap-2"><b>{brl(e.amount)}</b>
                    <button aria-label="Excluir despesa" className="text-slate-500 hover:text-rose-300" onClick={() => void run(() => api.remove("expenses", e.id), "Despesa excluída")}><Trash2 className="h-4 w-4" /></button></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {pay !== null && <PaymentModal installmentId={pay === "new" ? undefined : pay} onClose={() => setPay(null)} />}
      {modal === "expense" && <ExpenseModal onClose={() => setModal(null)} />}
      {modal === "charge" && <ChargeModal onClose={() => setModal(null)} />}
    </>
  );
}
