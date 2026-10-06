import { useState } from "react";
import { Check, Pencil, Plus, Send, Trash2, X } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { Badge, Card, Confirm, DemoTag, Empty, Field, Modal, MoneyInput, PageHeader, statusTone } from "../ui";
import { addDays, brl, clientLabel, effStatus, fmtDate, localDay, range, todayISO } from "../lib";
import type { Proposal } from "../types";
import { ProposalModal, type PageProps } from "./shared";

function ApproveModal({ proposal, onClose, go }: { proposal: Proposal; onClose: () => void; go: (id: string) => void }) {
  const { run } = useStore();
  const [entrada, setEntrada] = useState(0);
  const [parcelas, setParcelas] = useState(1);
  const [first, setFirst] = useState(addDays(todayISO(), 30));
  const [busy, setBusy] = useState(false);
  const rest = proposal.value - entrada;
  const invalid = entrada < 0 || entrada >= proposal.value;
  const save = async () => {
    setBusy(true);
    const ok = await run(() => api.post(`proposals/${proposal.id}/approve`, { entrada, parcelas, primeiro_vencimento: first }), "Proposta aprovada: projeto e parcelas criados");
    setBusy(false);
    if (ok) { onClose(); go("projetos"); }
  };
  return (
    <Modal title="Aprovar proposta" onClose={onClose}>
      <p className="mb-4 text-sm text-slate-400">Isso cria o projeto e o plano de pagamento. Valor total: <b className="text-slate-100">{brl(proposal.value)}</b></p>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Entrada (R$)" hint="Cobrada hoje. Deixe vazio se não houver."><MoneyInput cents={entrada} onChange={setEntrada} /></Field>
          <Field label="Nº de parcelas do restante"><input className="field" type="number" min={1} max={24} value={parcelas} onChange={(e) => setParcelas(Math.max(1, Number(e.target.value) || 1))} /></Field>
        </div>
        <Field label="Vencimento da primeira parcela"><input className="field" type="date" value={first} onChange={(e) => setFirst(e.target.value)} /></Field>
        <p className="rounded-xl bg-white/5 p-3 text-sm text-slate-300">
          {invalid ? "A entrada deve ser menor que o valor total." : `${entrada > 0 ? `Entrada de ${brl(entrada)} + ` : ""}${parcelas}× de ${brl(Math.floor(rest / parcelas))}`}
        </p>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={busy || invalid} onClick={save}>{busy ? "Aprovando…" : "Aprovar proposta"}</button>
      </div>
    </Modal>
  );
}

export default function Proposals({ go }: PageProps) {
  const { data, filters, run } = useStore();
  const d = data!;
  const [edit, setEdit] = useState<Proposal | "new" | null>(null);
  const [approve, setApprove] = useState<Proposal | null>(null);
  const [del, setDel] = useState<Proposal | null>(null);
  const clients = new Map(d.clients.map((c) => [c.id, c]));
  const q = filters.q.trim().toLowerCase();
  const { from: pf, to: pt } = range(filters);

  const list = d.proposals.filter((p) => {
    if (filters.clientId && String(p.client_id) !== filters.clientId) return false;
    if (filters.service && p.service !== filters.service) return false;
    if (filters.status && effStatus(p) !== filters.status) return false;
    const day = localDay(p.created_at);
    const open = ["rascunho", "enviada"].includes(effStatus(p));
    if (!open && (day < pf || day > pt)) return false; // propostas em aberto aparecem sempre
    const c = clients.get(p.client_id);
    return !q || [c?.name, c?.company, p.service, p.scope].some((x) => x?.toLowerCase().includes(q));
  });
  const total = list.reduce((a, p) => a + p.value, 0);

  return (
    <>
      <PageHeader title="Propostas" sub={`${list.length} proposta(s) · ${brl(total)}`}>
        <button className="btn btn-primary" onClick={() => setEdit("new")}><Plus className="h-4 w-4" /> Nova proposta</button>
      </PageHeader>
      <Card>
        {!list.length ? (
          <Empty title={d.proposals.length ? "Nenhuma proposta nesse filtro" : "Nenhuma proposta ainda"} text={d.proposals.length ? "Ajuste os filtros ou o período." : "Crie uma proposta; ao aprová-la, o projeto e as parcelas são gerados automaticamente."}
            action={!d.proposals.length ? <button className="btn btn-primary" onClick={() => setEdit("new")}>Nova proposta</button> : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="th">Cliente</th><th className="th">Serviço</th><th className="th text-right">Valor</th><th className="th">Prazo</th><th className="th">Validade</th><th className="th">Status</th><th className="th" /></tr></thead>
              <tbody>
                {list.map((p) => {
                  const st = effStatus(p);
                  return (
                    <tr key={p.id}>
                      <td className="td"><div className="flex items-center gap-2">{clientLabel(clients.get(p.client_id))}{p.demo ? <DemoTag /> : null}</div></td>
                      <td className="td"><div>{p.service}</div>{p.scope && <div className="max-w-56 truncate text-xs text-slate-500">{p.scope}</div>}</td>
                      <td className="td text-right font-medium">{brl(p.value)}</td>
                      <td className="td">{fmtDate(p.deadline)}</td>
                      <td className="td">{fmtDate(p.valid_until)}</td>
                      <td className="td"><Badge tone={statusTone[st] as never}>{st}</Badge></td>
                      <td className="td whitespace-nowrap text-right">
                        {["rascunho", "enviada", "expirada"].includes(st) && (
                          <>
                            {st === "rascunho" && <button className="btn mr-1 !px-2.5 !py-1" onClick={() => void run(() => api.update("proposals", p.id, { status: "enviada" }), "Proposta marcada como enviada")}><Send className="h-3.5 w-3.5" /> Enviar</button>}
                            <button className="btn btn-primary mr-1 !px-2.5 !py-1" onClick={() => setApprove(p)}><Check className="h-3.5 w-3.5" /> Aprovar</button>
                            <button className="btn mr-1 !px-2.5 !py-1" onClick={() => void run(() => api.update("proposals", p.id, { status: "recusada" }), "Proposta recusada")}><X className="h-3.5 w-3.5" /> Recusar</button>
                          </>
                        )}
                        <button className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10" aria-label="Editar" onClick={() => setEdit(p)}><Pencil className="h-4 w-4" /></button>
                        {st !== "aprovada" && <button className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10" aria-label="Excluir" onClick={() => setDel(p)}><Trash2 className="h-4 w-4" /></button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {edit && <ProposalModal proposal={edit === "new" ? undefined : edit} onClose={() => setEdit(null)} />}
      {approve && <ApproveModal proposal={approve} go={go} onClose={() => setApprove(null)} />}
      {del && <Confirm text="Excluir esta proposta?" onNo={() => setDel(null)} onYes={() => { void run(() => api.remove("proposals", del.id), "Proposta excluída"); setDel(null); }} />}
    </>
  );
}
