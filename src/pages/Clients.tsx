import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { Badge, Card, Confirm, DemoTag, Empty, Modal, PageHeader, statusTone } from "../ui";
import { brl, effStatus, fmtDate } from "../lib";
import type { Client } from "../types";
import { ClientModal, type PageProps } from "./shared";

function History({ client, onClose }: { client: Client; onClose: () => void }) {
  const { data } = useStore();
  const d = data!;
  const props = d.proposals.filter((p) => p.client_id === client.id);
  const projs = d.projects.filter((p) => p.client_id === client.id);
  const pays = d.payments.filter((p) => p.client_id === client.id);
  return (
    <Modal title={client.company ? `${client.company} · ${client.name}` : client.name} onClose={onClose} wide>
      <p className="mb-4 text-sm text-slate-400">{[client.email, client.phone].filter(Boolean).join(" · ") || "Sem contato cadastrado"}</p>
      {client.notes && <p className="mb-4 rounded-xl bg-white/5 p-3 text-sm text-slate-300">{client.notes}</p>}
      <div className="grid gap-5 md:grid-cols-3">
        <section>
          <h4 className="mb-2 text-sm font-semibold">Propostas ({props.length})</h4>
          {!props.length ? <p className="text-sm text-slate-500">Nenhuma proposta.</p> : props.map((p) => (
            <div key={p.id} className="mb-2 rounded-xl bg-white/5 p-3 text-sm"><div className="flex justify-between gap-2"><span>{p.service}</span><Badge tone={statusTone[effStatus(p)] as never}>{effStatus(p)}</Badge></div><span className="text-slate-400">{brl(p.value)}</span></div>
          ))}
        </section>
        <section>
          <h4 className="mb-2 text-sm font-semibold">Projetos ({projs.length})</h4>
          {!projs.length ? <p className="text-sm text-slate-500">Nenhum projeto.</p> : projs.map((p) => (
            <div key={p.id} className="mb-2 rounded-xl bg-white/5 p-3 text-sm"><div>{p.name ?? p.service}</div><span className="text-slate-400">{p.cancelled ? "Cancelado" : p.stage} · prazo {fmtDate(p.deadline)}</span></div>
          ))}
        </section>
        <section>
          <h4 className="mb-2 text-sm font-semibold">Pagamentos ({pays.length})</h4>
          {!pays.length ? <p className="text-sm text-slate-500">Nenhum pagamento.</p> : pays.slice(0, 8).map((p) => (
            <div key={p.id} className="mb-2 rounded-xl bg-white/5 p-3 text-sm"><div className={p.type === "refund" ? "text-rose-300" : "text-emerald-300"}>{p.type === "refund" ? "−" : "+"}{brl(p.amount)}</div><span className="text-slate-400">{fmtDate(p.paid_at)} · {p.source === "manual" ? "manual" : p.source}</span></div>
          ))}
        </section>
      </div>
    </Modal>
  );
}

export default function Clients(_: PageProps) {
  const { data, filters, run } = useStore();
  const d = data!;
  const [edit, setEdit] = useState<Client | "new" | null>(null);
  const [view, setView] = useState<Client | null>(null);
  const [del, setDel] = useState<Client | null>(null);
  const q = filters.q.trim().toLowerCase();
  const list = d.clients.filter((c) => !q || [c.name, c.company, c.email, c.phone].some((x) => x?.toLowerCase().includes(q)));

  return (
    <>
      <PageHeader title="Clientes" sub={`${d.clients.length} cadastrado(s)`}>
        <button className="btn btn-primary" onClick={() => setEdit("new")}><Plus className="h-4 w-4" /> Novo cliente</button>
      </PageHeader>
      <Card>
        {!list.length ? (
          <Empty title={d.clients.length ? "Nenhum cliente encontrado" : "Nenhum cliente ainda"} text={d.clients.length ? "Ajuste a busca." : "Cadastre seu primeiro cliente para criar propostas e projetos."}
            action={!d.clients.length ? <button className="btn btn-primary" onClick={() => setEdit("new")}>Novo cliente</button> : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="th">Cliente</th><th className="th">Contato</th><th className="th">Propostas</th><th className="th">Projetos</th><th className="th text-right">Recebido</th><th className="th" /></tr></thead>
              <tbody>
                {list.map((c) => {
                  const rec = d.payments.filter((p) => p.client_id === c.id).reduce((s, p) => s + (p.type === "refund" ? -p.amount : p.amount), 0);
                  return (
                    <tr key={c.id} className="cursor-pointer hover:bg-white/[.03]" onClick={() => setView(c)}>
                      <td className="td"><div className="flex items-center gap-2 font-medium">{c.company || c.name}{c.demo ? <DemoTag /> : null}</div>{c.company && <div className="text-xs text-slate-500">{c.name}</div>}</td>
                      <td className="td text-slate-400">{c.email ?? "—"}<div className="text-xs">{c.phone}</div></td>
                      <td className="td">{d.proposals.filter((p) => p.client_id === c.id).length}</td>
                      <td className="td">{d.projects.filter((p) => p.client_id === c.id).length}</td>
                      <td className="td text-right font-medium text-emerald-300">{brl(rec)}</td>
                      <td className="td text-right" onClick={(e) => e.stopPropagation()}>
                        <button className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10" aria-label="Editar" onClick={() => setEdit(c)}><Pencil className="h-4 w-4" /></button>
                        <button className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10" aria-label="Excluir" onClick={() => setDel(c)}><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {edit && <ClientModal client={edit === "new" ? undefined : edit} onClose={() => setEdit(null)} />}
      {view && <History client={view} onClose={() => setView(null)} />}
      {del && <Confirm text={`Excluir ${del.company || del.name}? Só é possível se não houver propostas, projetos ou pagamentos vinculados.`} onNo={() => setDel(null)}
        onYes={() => { void run(() => api.remove("clients", del.id), "Cliente excluído"); setDel(null); }} />}
    </>
  );
}
