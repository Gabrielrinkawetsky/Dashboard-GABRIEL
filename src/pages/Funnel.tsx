import { useEffect, useState, type FormEvent } from "react";
import { Columns3, ExternalLink, LayoutList, Plus, Search, Trash2 } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { useApi, listQuery, type ListState } from "../useApi";
import { Pager, SortTh } from "../pager";
import { Badge, Card, Confirm, DemoTag, Empty, Field, Modal, MoneyInput, PageHeader, Skeleton } from "../ui";
import { brl, fmtDate, todayISO } from "../lib";
import { OPP_SOURCES, OPP_STAGES, type Board, type OppDetail, type Opportunity, type Paged } from "../types";
import type { PageProps } from "./shared";

const OPEN = OPP_STAGES.slice(0, 5);
const stageTone = (s: string) => (s === "Ganho" ? "good" : s === "Perdido" ? "bad" : s === "Novo lead" ? "muted" : "violet");

function NextContact({ date }: { date: string | null }) {
  if (!date) return <span className="text-xs text-slate-500">sem data de retorno</span>;
  const t = todayISO();
  if (date < t) return <Badge tone="bad">Retorno atrasado · {fmtDate(date)}</Badge>;
  if (date === t) return <Badge tone="warn">Retornar hoje</Badge>;
  return <span className="text-xs text-slate-400">Retorno {fmtDate(date)}</span>;
}

// --------------------------------------------------------------------------------------------------------
// Formulário (cadastro e edição)
// --------------------------------------------------------------------------------------------------------
type FormState = { name: string; company: string; email: string; phone: string; source: string; service: string; value: number; next_contact: string; owner: string; notes: string };
const toForm = (o?: Opportunity): FormState => ({
  name: o?.name ?? "", company: o?.company ?? "", email: o?.email ?? "", phone: o?.phone ?? "", source: o?.source ?? "Outro",
  service: o?.service ?? "", value: o?.value ?? 0, next_contact: o?.next_contact ?? "", owner: o?.owner ?? "", notes: o?.notes ?? "",
});

function OppFields({ f, setF }: { f: FormState; setF: (f: FormState) => void }) {
  const { data } = useStore();
  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="space-y-3">
      <Field label="Nome *"><input className="field" required value={f.name} onChange={set("name")} autoComplete="off" /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Empresa"><input className="field" value={f.company} onChange={set("company")} autoComplete="off" /></Field>
        <Field label="Origem do lead">
          <select className="field" value={f.source} onChange={set("source")}>{OPP_SOURCES.map((s) => <option key={s}>{s}</option>)}</select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="E-mail"><input className="field" type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Telefone / WhatsApp" hint="Informe e-mail ou telefone"><input className="field" inputMode="tel" value={f.phone} onChange={set("phone")} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Serviço de interesse">
          <select className="field" value={f.service} onChange={set("service")}>
            <option value="">—</option>
            {data?.services.filter((s) => s.active).map((s) => <option key={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Valor estimado (R$)"><MoneyInput cents={f.value} onChange={(value) => setF({ ...f, value })} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Próximo contato"><input className="field" type="date" value={f.next_contact} onChange={set("next_contact")} /></Field>
        <Field label="Responsável"><input className="field" value={f.owner} onChange={set("owner")} /></Field>
      </div>
      <Field label="Observações"><textarea className="field" rows={3} value={f.notes} onChange={set("notes")} /></Field>
    </div>
  );
}

function CreateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { run } = useStore();
  const [f, setF] = useState<FormState>(toForm());
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await run(() => api.create("opportunities", f), "Oportunidade criada");
    setBusy(false);
    if (ok) { onDone(); onClose(); }
  };
  return (
    <Modal title="Nova oportunidade" onClose={onClose}>
      <form onSubmit={submit}>
        <OppFields f={f} setF={setF} />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? "Salvando…" : "Criar oportunidade"}</button>
        </div>
      </form>
    </Modal>
  );
}

// --------------------------------------------------------------------------------------------------------
// Motivo da perda
// --------------------------------------------------------------------------------------------------------
function LostDialog({ opp, onClose, onDone }: { opp: Opportunity; onClose: () => void; onDone: () => void }) {
  const { run } = useStore();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await run(() => api.post(`opportunities/${opp.id}/move`, { stage: "Perdido", lost_reason: reason }), "Marcada como perdida");
    setBusy(false);
    if (ok) { onDone(); onClose(); }
  };
  return (
    <Modal title="Marcar como perdida" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-slate-400">{opp.name}{opp.company ? ` · ${opp.company}` : ""}</p>
        <Field label="Motivo da perda *" hint="Ajuda a entender o que melhorar nas próximas propostas.">
          <input className="field" required autoFocus maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} list="motivos-perda" />
          <datalist id="motivos-perda"><option value="Preço acima do orçamento" /><option value="Escolheu outro fornecedor" /><option value="Sem retorno do cliente" /><option value="Projeto adiado ou cancelado" /><option value="Não era o perfil de cliente" /></datalist>
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-danger" disabled={busy || !reason.trim()}>Confirmar perda</button>
        </div>
      </form>
    </Modal>
  );
}

// --------------------------------------------------------------------------------------------------------
// Detalhe
// --------------------------------------------------------------------------------------------------------
function Detail({ id, onClose, onChanged, go }: { id: number; onClose: () => void; onChanged: () => void; go: (p: string) => void }) {
  const { run, reload } = useStore();
  const { data: opp, loading, error, reload: reloadOpp } = useApi<OppDetail>(`opportunities/${id}`);
  const [f, setF] = useState<FormState | null>(null);
  const [note, setNote] = useState("");
  const [lost, setLost] = useState(false);
  const [del, setDel] = useState(false);
  useEffect(() => { if (opp) setF(toForm(opp)); }, [opp?.id, opp?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const after = async () => { await reloadOpp(); onChanged(); await reload(); };
  const act = async (fn: () => Promise<unknown>, ok: string) => { if (await run(fn, ok)) await after(); };
  const closed = opp ? opp.stage === "Ganho" || opp.stage === "Perdido" : false;

  return (
    <Modal title={opp?.name ?? "Oportunidade"} onClose={onClose} wide>
      {loading && !opp ? <Skeleton className="h-64" /> : error || !opp || !f ? <Empty title="Não foi possível abrir" text={error ?? undefined} /> : (
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge tone={stageTone(opp.stage) as never}>{opp.stage}</Badge>
              {opp.demo ? <DemoTag /> : null}
              <NextContact date={opp.next_contact} />
            </div>
            {opp.lost_reason && <p className="mb-3 rounded-xl bg-rose-400/10 p-3 text-sm text-rose-200">Motivo da perda: {opp.lost_reason}</p>}
            <form onSubmit={(e) => { e.preventDefault(); void act(() => api.update("opportunities", id, f), "Dados salvos"); }}>
              <OppFields f={f} setF={setF} />
              <button className="btn btn-primary mt-3">Salvar dados</button>
            </form>
          </div>
          <div className="space-y-5">
            <section>
              <h4 className="mb-2 text-sm font-semibold">Etapa</h4>
              <label className="sr-only" htmlFor="mover-etapa">Mover para a etapa</label>
              <select id="mover-etapa" className="field" value={opp.stage} onChange={(e) => {
                const to = e.target.value;
                if (to === "Perdido") setLost(true);
                else void act(() => api.post(`opportunities/${id}/move`, { stage: to }), to === "Ganho" ? "Ganho! Cliente criado/vinculado" : `Movida para ${to}`);
              }}>
                {OPP_STAGES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </section>
            <section>
              <h4 className="mb-2 text-sm font-semibold">Cliente e proposta</h4>
              {opp.client ? (
                <p className="text-sm text-slate-300">Cliente: <b>{opp.client.company || opp.client.name}</b> <button className="ml-1 inline-flex items-center gap-1 text-violet hover:underline" onClick={() => { onClose(); go("clientes"); }}>ver clientes <ExternalLink className="h-3 w-3" /></button></p>
              ) : <p className="text-sm text-slate-500">Ainda não é cliente.</p>}
              {opp.proposal && <p className="mt-1 text-sm text-slate-300">Proposta #{opp.proposal.id}: {opp.proposal.service} · {brl(opp.proposal.value)} · {opp.proposal.status} <button className="ml-1 inline-flex items-center gap-1 text-violet hover:underline" onClick={() => { onClose(); go("propostas"); }}>ver propostas <ExternalLink className="h-3 w-3" /></button></p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {!opp.client && <button className="btn" onClick={() => void act(() => api.post(`opportunities/${id}/convert`, {}), "Convertida em cliente (sem duplicar)")}>Converter em cliente</button>}
                {!opp.proposal && (
                  <button className="btn btn-primary" disabled={!opp.service || opp.value <= 0} title={!opp.service || opp.value <= 0 ? "Informe o serviço e o valor estimado e salve os dados" : undefined}
                    onClick={() => void act(() => api.post(`opportunities/${id}/convert`, { create_proposal: true }), "Cliente e proposta em rascunho criados")}>Criar proposta</button>
                )}
              </div>
            </section>
            <section>
              <h4 className="mb-2 text-sm font-semibold">Histórico</h4>
              <form className="mb-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!note.trim()) return; void act(() => api.post(`opportunities/${id}/notes`, { text: note }), "Anotação adicionada"); setNote(""); }}>
                <input className="field" aria-label="Nova anotação" placeholder="Registrar contato ou anotação…" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
                <button className="btn">Anotar</button>
              </form>
              <ul className="max-h-60 space-y-1 overflow-y-auto border-l border-white/10 pl-3 text-sm">
                {opp.events.map((ev) => <li key={ev.id}><span className="text-xs text-slate-500">{fmtDate(ev.at)}</span> {ev.text}</li>)}
              </ul>
            </section>
            <div className="flex justify-between border-t border-white/10 pt-3">
              <span className="text-xs text-slate-500">{closed ? `Fechada em ${fmtDate(opp.closed_at)}` : `Criada em ${fmtDate(opp.created_at)}`}</span>
              <button className="btn btn-danger !px-2.5 !py-1" onClick={() => setDel(true)}><Trash2 className="h-3.5 w-3.5" /> Excluir</button>
            </div>
          </div>
        </div>
      )}
      {lost && opp && <LostDialog opp={opp} onClose={() => setLost(false)} onDone={() => void after()} />}
      {del && <Confirm text="Excluir esta oportunidade e o histórico dela? Clientes já criados são mantidos." onNo={() => setDel(false)}
        onYes={() => { setDel(false); void run(() => api.remove("opportunities", id), "Oportunidade excluída").then((ok) => { if (ok) { onChanged(); onClose(); } }); }} />}
    </Modal>
  );
}

// --------------------------------------------------------------------------------------------------------
// Página
// --------------------------------------------------------------------------------------------------------
export default function Funnel({ go }: PageProps) {
  const { data, run } = useStore();
  const [view, setView] = useState<"quadro" | "lista">("quadro");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [lostFor, setLostFor] = useState<Opportunity | null>(null);
  const [list, setList] = useState<ListState>({ page: 1, sort: "atualizado", dir: "desc", q: "", filters: {} });
  const [search, setSearch] = useState("");
  const board = useApi<Board>("opportunities/board");
  const rows = useApi<Paged<Opportunity>>(view === "lista" ? `opportunities?${listQuery(list)}` : null);

  useEffect(() => { const t = setTimeout(() => setList((l) => (l.q === search ? l : { ...l, q: search, page: 1 })), 300); return () => clearTimeout(t); }, [search]);
  const refresh = () => { void board.reload(); void rows.reload(); };
  const sort = (k: string) => setList((l) => ({ ...l, sort: k, dir: l.sort === k && l.dir === "asc" ? "desc" : "asc", page: 1 }));
  const setFilter = (k: string, v: string) => setList((l) => ({ ...l, filters: { ...l.filters, [k]: v }, page: 1 }));
  const move = async (o: Opportunity, to: string) => {
    if (to === "Perdido") return setLostFor(o);
    if (await run(() => api.post(`opportunities/${o.id}/move`, { stage: to }), to === "Ganho" ? "Ganho! Cliente criado/vinculado" : `Movida para ${to}`)) refresh();
  };

  const b = board.data;
  const open = b ? b.stages.reduce((a, s) => ({ n: a.n + s.total, v: a.v + s.value }), { n: 0, v: 0 }) : null;
  const decided = b ? b.won.total + b.lost.total : 0;
  const rate = b && decided ? Math.round((b.won.total / decided) * 100) : null;

  return (
    <>
      <PageHeader title="Funil de vendas" sub="De novo lead até ganho ou perdido, sem perder nenhum retorno">
        <div className="glass flex rounded-xl p-0.5" role="group" aria-label="Modo de exibição">
          {([["quadro", Columns3, "Quadro"], ["lista", LayoutList, "Lista"]] as const).map(([v, Icon, l]) => (
            <button key={v} onClick={() => setView(v)} aria-label={l} aria-pressed={view === v} className={`rounded-lg px-3 py-1.5 text-sm ${view === v ? "bg-violet/20 text-violet" : "text-slate-400"}`}><Icon className="h-4 w-4" /></button>
          ))}
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nova oportunidade</button>
      </PageHeader>

      <section className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Resumo do funil">
        {!b ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />) : (
          <>
            <div className="glass rounded-2xl p-4"><p className="text-xs text-slate-400">Em aberto</p><p className="mt-1 text-2xl font-bold">{open!.n}</p><p className="text-xs text-slate-500">{brl(open!.v)} estimados</p></div>
            <div className="glass rounded-2xl p-4"><p className="text-xs text-slate-400">Ganhas ({b.sinceDays} dias)</p><p className="mt-1 text-2xl font-bold text-emerald-300">{b.won.total}</p><p className="text-xs text-slate-500">{brl(b.won.value)}</p></div>
            <div className="glass rounded-2xl p-4"><p className="text-xs text-slate-400">Perdidas ({b.sinceDays} dias)</p><p className="mt-1 text-2xl font-bold text-rose-300">{b.lost.total}</p><p className="text-xs text-slate-500">{brl(b.lost.value)}</p></div>
            <div className="glass rounded-2xl p-4"><p className="text-xs text-slate-400">Taxa de conversão</p><p className="mt-1 text-2xl font-bold text-violet">{rate === null ? "—" : `${rate}%`}</p><p className="text-xs text-slate-500">{rate === null ? "sem negócios decididos" : "ganhas ÷ decididas"}</p></div>
          </>
        )}
      </section>

      {board.error && <Card className="mb-4"><p className="text-sm text-rose-300">{board.error}</p></Card>}

      {view === "quadro" ? (
        !b ? <Skeleton className="h-72" /> : b.stages.every((s) => s.total === 0) ? (
          <Card><Empty title="Seu funil está vazio" text="Cadastre a primeira oportunidade, ou divulgue o formulário de captura (Configurações → Captura de leads) para os leads chegarem sozinhos."
            action={<button className="btn btn-primary" onClick={() => setCreating(true)}>Nova oportunidade</button>} /></Card>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {b.stages.map((col) => (
              <section key={col.stage} className="glass w-72 shrink-0 rounded-2xl p-3" aria-label={`Etapa ${col.stage}`}>
                <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-300"><span>{col.stage}</span><span className="rounded-full bg-white/10 px-2 py-0.5">{col.total}</span></div>
                <p className="mb-2 text-xs text-slate-500">{brl(col.value)}</p>
                <div className="space-y-2">
                  {col.items.map((o) => (
                    <div key={o.id} className="rounded-xl border border-white/10 bg-white/[.04] p-3">
                      <button className="mb-1 block w-full text-left text-sm font-medium hover:text-violet focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet" onClick={() => setOpenId(o.id)}>{o.name}</button>
                      <p className="text-xs text-slate-500">{[o.company, o.service].filter(Boolean).join(" · ") || "—"}</p>
                      <p className="mt-1 text-sm font-semibold">{o.value ? brl(o.value) : "—"}</p>
                      <div className="mt-1"><NextContact date={o.next_contact} /></div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        {o.demo ? <DemoTag /> : <span className="text-xs text-slate-600">{o.source}</span>}
                        <select aria-label={`Mover ${o.name} para outra etapa`} className="field !w-auto !py-1 !text-xs" value={o.stage} onChange={(e) => void move(o, e.target.value)}>
                          {OPP_STAGES.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>
                  ))}
                  {col.total > col.items.length && <p className="text-center text-xs text-slate-500">+{col.total - col.items.length} na lista</p>}
                </div>
              </section>
            ))}
          </div>
        )
      ) : (
        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
              <input className="field pl-9" placeholder="Buscar por nome, empresa, e-mail…" aria-label="Buscar oportunidades" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select className="field w-auto" aria-label="Filtrar por etapa" value={list.filters.stage ?? ""} onChange={(e) => setFilter("stage", e.target.value)}>
              <option value="">Todas as etapas</option>{OPP_STAGES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <select className="field w-auto" aria-label="Filtrar por origem" value={list.filters.source ?? ""} onChange={(e) => setFilter("source", e.target.value)}>
              <option value="">Todas as origens</option>{OPP_SOURCES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <select className="field w-auto" aria-label="Filtrar por serviço" value={list.filters.service ?? ""} onChange={(e) => setFilter("service", e.target.value)}>
              <option value="">Todos os serviços</option>{data?.services.map((s) => <option key={s.id}>{s.name}</option>)}
            </select>
          </div>
          {rows.loading && !rows.data ? <Skeleton className="h-48" /> : rows.error ? <p className="text-sm text-rose-300">{rows.error}</p> : !rows.data?.total ? (
            <Empty title="Nenhuma oportunidade encontrada" text="Ajuste a busca ou os filtros." />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <caption className="sr-only">Oportunidades do funil de vendas</caption>
                  <thead><tr>
                    <SortTh label="Nome" k="nome" sort={rows.data.sort} dir={rows.data.dir} onSort={sort} />
                    <SortTh label="Etapa" k="etapa" sort={rows.data.sort} dir={rows.data.dir} onSort={sort} />
                    <th className="th">Origem</th>
                    <SortTh label="Valor" k="valor" sort={rows.data.sort} dir={rows.data.dir} onSort={sort} className="text-right" />
                    <SortTh label="Próx. contato" k="proximo_contato" sort={rows.data.sort} dir={rows.data.dir} onSort={sort} />
                    <SortTh label="Atualizado" k="atualizado" sort={rows.data.sort} dir={rows.data.dir} onSort={sort} />
                  </tr></thead>
                  <tbody>
                    {rows.data.items.map((o) => (
                      <tr key={o.id} className="cursor-pointer hover:bg-white/[.03]" onClick={() => setOpenId(o.id)}>
                        <td className="td"><button className="text-left font-medium hover:text-violet focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet" onClick={(e) => { e.stopPropagation(); setOpenId(o.id); }}>{o.name}</button>{o.demo ? <span className="ml-2"><DemoTag /></span> : null}<div className="text-xs text-slate-500">{o.company ?? ""}</div></td>
                        <td className="td"><Badge tone={stageTone(o.stage) as never}>{o.stage}</Badge></td>
                        <td className="td text-slate-400">{o.source ?? "—"}</td>
                        <td className="td text-right">{o.value ? brl(o.value) : "—"}</td>
                        <td className="td">{o.stage === "Ganho" || o.stage === "Perdido" ? "—" : <NextContact date={o.next_contact} />}</td>
                        <td className="td text-slate-400">{fmtDate(o.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={rows.data.page} pages={rows.data.pages} total={rows.data.total} onPage={(p) => setList((l) => ({ ...l, page: p }))} />
            </>
          )}
        </Card>
      )}

      {creating && <CreateModal onClose={() => setCreating(false)} onDone={refresh} />}
      {openId !== null && <Detail id={openId} go={go} onClose={() => setOpenId(null)} onChanged={refresh} />}
      {lostFor && <LostDialog opp={lostFor} onClose={() => setLostFor(null)} onDone={refresh} />}
    </>
  );
}
void OPEN;
