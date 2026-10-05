import { useState } from "react";
import { ChevronLeft, ChevronRight, LayoutList, Columns3, Plus, Trash2 } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { Badge, Card, DemoTag, Empty, Field, Modal, PageHeader, Progress } from "../ui";
import { brl, clientLabel, fmtDate, instPaid, instStatus, todayISO } from "../lib";
import { STAGES, type Project } from "../types";
import { ProjectModal, type PageProps } from "./shared";

function Detail({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, run } = useStore();
  const d = data!;
  const p = d.projects.find((x) => x.id === id);
  const [note, setNote] = useState("");
  const [item, setItem] = useState("");
  if (!p) return null;
  const client = d.clients.find((c) => c.id === p.client_id);
  const hist = d.history.filter((h) => h.project_id === id);
  const insts = d.installments.filter((i) => i.project_id === id);
  const patch = (b: Partial<Project>, ok?: string) => run(() => api.update("projects", id, b), ok);
  const toggle = (idx: number) => patch({ checklist: p.checklist.map((c, i) => (i === idx ? { ...c, done: !c.done } : c)) });
  const done = p.checklist.length ? Math.round((p.checklist.filter((c) => c.done).length / p.checklist.length) * 100) : p.progress;

  return (
    <Modal title={p.name ?? p.service} onClose={onClose} wide>
      <p className="mb-4 text-sm text-slate-400">{clientLabel(client)} · {p.service}</p>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Etapa">
              <select className="field" value={p.stage} onChange={(e) => void patch({ stage: e.target.value })}>{STAGES.map((s) => <option key={s}>{s}</option>)}</select>
            </Field>
            <Field label="Prazo"><input className="field" type="date" defaultValue={p.deadline ?? ""} onBlur={(e) => e.target.value !== (p.deadline ?? "") && void patch({ deadline: e.target.value })} /></Field>
          </div>
          <Field label="Responsável"><input className="field" defaultValue={p.owner ?? ""} onBlur={(e) => e.target.value !== (p.owner ?? "") && void patch({ owner: e.target.value })} /></Field>
          <Field label="Escopo"><textarea className="field" rows={3} defaultValue={p.scope ?? ""} onBlur={(e) => e.target.value !== (p.scope ?? "") && void patch({ scope: e.target.value })} /></Field>
          <Field label="Arquivos e links importantes"><textarea className="field" rows={2} placeholder="Uma URL por linha" defaultValue={p.links ?? ""} onBlur={(e) => e.target.value !== (p.links ?? "") && void patch({ links: e.target.value })} /></Field>
          <Field label="Observações"><textarea className="field" rows={2} defaultValue={p.notes ?? ""} onBlur={(e) => e.target.value !== (p.notes ?? "") && void patch({ notes: e.target.value })} /></Field>
        </div>
        <div className="space-y-4">
          <section>
            <div className="mb-1 flex items-center justify-between text-sm font-semibold"><span>Checklist</span><span className="text-slate-400">{done}%</span></div>
            <Progress value={done} />
            <ul className="mt-2 space-y-1">
              {p.checklist.map((c, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={c.done} onChange={() => void toggle(i)} className="accent-violet-400" />
                  <span className={`flex-1 ${c.done ? "text-slate-500 line-through" : ""}`}>{c.text}</span>
                  <button aria-label="Remover item" className="text-slate-500 hover:text-rose-300" onClick={() => void patch({ checklist: p.checklist.filter((_, j) => j !== i) })}><Trash2 className="h-3.5 w-3.5" /></button>
                </li>
              ))}
            </ul>
            <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!item.trim()) return; void patch({ checklist: [...p.checklist, { text: item.trim(), done: false }] }); setItem(""); }}>
              <input className="field" placeholder="Novo item…" value={item} onChange={(e) => setItem(e.target.value)} />
              <button className="btn">Adicionar</button>
            </form>
          </section>
          <section>
            <h4 className="mb-1 text-sm font-semibold">Pagamentos do projeto</h4>
            {!insts.length ? <p className="text-sm text-slate-500">Sem parcelas vinculadas.</p> : insts.map((i) => (
              <div key={i.id} className="flex items-center justify-between py-1 text-sm">
                <span>{i.label} · {fmtDate(i.due_date)}</span>
                <span className="flex items-center gap-2">{brl(i.amount)} <Badge tone={({ paga: "good", atrasada: "bad", parcial: "warn", aberta: "muted" } as const)[instStatus(d, i)]}>{instStatus(d, i)}</Badge></span>
              </div>
            ))}
            {insts.length > 0 && <p className="mt-1 text-xs text-slate-500">Recebido: {brl(insts.reduce((a, i) => a + instPaid(d, i.id), 0))} de {brl(insts.reduce((a, i) => a + i.amount, 0))}</p>}
          </section>
        </div>
      </div>

      <section className="mt-5">
        <h4 className="mb-2 text-sm font-semibold">Histórico de alterações</h4>
        <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!note.trim()) return; void run(() => api.post(`projects/${id}/notes`, { text: note }), "Anotação adicionada"); setNote(""); }}>
          <input className="field" placeholder="Adicionar anotação ao histórico…" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn">Anotar</button>
        </form>
        <ul className="max-h-44 space-y-1 overflow-y-auto border-l border-white/10 pl-3 text-sm">
          {hist.map((h) => <li key={h.id}><span className="text-xs text-slate-500">{fmtDate(h.at)}</span> {h.text}</li>)}
        </ul>
      </section>

      <div className="mt-5 flex justify-end">
        <button className="btn btn-danger" onClick={() => void patch({ cancelled: p.cancelled ? 0 : 1 }, p.cancelled ? "Projeto reaberto" : "Projeto cancelado")}>{p.cancelled ? "Reabrir projeto" : "Cancelar projeto"}</button>
      </div>
    </Modal>
  );
}

export default function Projects(_: PageProps) {
  const { data, filters, run } = useStore();
  const d = data!;
  const [view, setView] = useState<"quadro" | "lista">("quadro");
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const clients = new Map(d.clients.map((c) => [c.id, c]));
  const q = filters.q.trim().toLowerCase();

  const list = d.projects.filter((p) => {
    if (filters.clientId && String(p.client_id) !== filters.clientId) return false;
    if (filters.service && p.service !== filters.service) return false;
    if (filters.status === "Cancelado" ? !p.cancelled : filters.status && (p.stage !== filters.status || p.cancelled)) return false;
    const c = clients.get(p.client_id);
    return !q || [c?.name, c?.company, p.name, p.service].some((x) => x?.toLowerCase().includes(q));
  });
  const move = (p: Project, dir: -1 | 1) => {
    const i = STAGES.indexOf(p.stage as never) + dir;
    if (i >= 0 && i < STAGES.length) void run(() => api.update("projects", p.id, { stage: STAGES[i] }), `Movido para ${STAGES[i]}`);
  };
  const late = (p: Project) => !p.cancelled && p.stage !== "Entregue" && !!p.deadline && p.deadline < todayISO();

  return (
    <>
      <PageHeader title="Projetos" sub={`${list.filter((p) => !p.cancelled && p.stage !== "Entregue").length} em andamento`}>
        <div className="glass flex rounded-xl p-0.5">
          {([["quadro", Columns3, "Quadro"], ["lista", LayoutList, "Lista"]] as const).map(([v, Icon, l]) => (
            <button key={v} onClick={() => setView(v)} aria-label={l} className={`rounded-lg px-3 py-1.5 text-sm ${view === v ? "bg-violet/20 text-violet" : "text-slate-400"}`}><Icon className="h-4 w-4" /></button>
          ))}
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Novo projeto</button>
      </PageHeader>

      {!list.length ? (
        <Card><Empty title={d.projects.length ? "Nenhum projeto nesse filtro" : "Nenhum projeto ainda"} text={d.projects.length ? "Ajuste os filtros ou o período." : "Projetos são criados ao aprovar uma proposta, ou manualmente aqui."} /></Card>
      ) : view === "quadro" ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {STAGES.map((st) => {
            const col = list.filter((p) => !p.cancelled && p.stage === st);
            return (
              <div key={st} className="glass w-64 shrink-0 rounded-2xl p-3">
                <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-300"><span>{st}</span><span className="rounded-full bg-white/10 px-2 py-0.5">{col.length}</span></div>
                <div className="space-y-2">
                  {col.map((p) => (
                    <div key={p.id} className="rounded-xl border border-white/10 bg-white/[.04] p-3">
                      <button className="mb-1 block w-full text-left text-sm font-medium hover:text-violet" onClick={() => setOpen(p.id)}>{p.name ?? p.service}</button>
                      <p className="text-xs text-slate-500">{clientLabel(clients.get(p.client_id))}</p>
                      <div className="my-2"><Progress value={p.checklist.length ? (p.checklist.filter((c) => c.done).length / p.checklist.length) * 100 : p.progress} /></div>
                      <div className="flex items-center justify-between text-xs">
                        <span className={late(p) ? "text-rose-300" : "text-slate-400"}>{fmtDate(p.deadline)}</span>
                        <span className="flex gap-1">
                          <button aria-label="Etapa anterior" className="rounded p-0.5 hover:bg-white/10 disabled:opacity-30" disabled={st === STAGES[0]} onClick={() => move(p, -1)}><ChevronLeft className="h-4 w-4" /></button>
                          <button aria-label="Próxima etapa" className="rounded p-0.5 hover:bg-white/10 disabled:opacity-30" disabled={st === STAGES[5]} onClick={() => move(p, 1)}><ChevronRight className="h-4 w-4" /></button>
                        </span>
                      </div>
                      {p.demo ? <div className="mt-1"><DemoTag /></div> : null}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="th">Projeto</th><th className="th">Cliente</th><th className="th">Etapa</th><th className="th">Prazo</th><th className="th">Responsável</th><th className="th w-40">Progresso</th></tr></thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} className="cursor-pointer hover:bg-white/[.03]" onClick={() => setOpen(p.id)}>
                    <td className="td font-medium"><span className="mr-2">{p.name ?? p.service}</span>{p.demo ? <DemoTag /> : null}</td>
                    <td className="td">{clientLabel(clients.get(p.client_id))}</td>
                    <td className="td">{p.cancelled ? <Badge tone="bad">Cancelado</Badge> : <Badge tone={p.stage === "Entregue" ? "good" : "violet"}>{p.stage}</Badge>}</td>
                    <td className={`td ${late(p) ? "text-rose-300" : ""}`}>{fmtDate(p.deadline)}</td>
                    <td className="td">{p.owner ?? "—"}</td>
                    <td className="td"><Progress value={p.checklist.length ? (p.checklist.filter((c) => c.done).length / p.checklist.length) * 100 : p.progress} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {open !== null && <Detail id={open} onClose={() => setOpen(null)} />}
      {adding && <ProjectModal onClose={() => setAdding(false)} />}
    </>
  );
}
