import { useState, type FormEvent, type ReactNode } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { Field, Modal, MoneyInput } from "../ui";
import { useApi } from "../useApi";
import { fromTemplate, type Template } from "../templates";
import { brl, clientLabel, fmtDate, instPaid, todayISO } from "../lib";
import type { Client, Proposal } from "../types";

export type PageProps = { go: (id: string) => void };

export function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" | "violet" }) {
  const color = tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-rose-300" : tone === "violet" ? "text-violet" : "text-slate-50";
  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold tracking-tight ${color}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function Form({ onSubmit, busy, children, submit = "Salvar", onClose }: { onSubmit: () => void; busy: boolean; children: ReactNode; submit?: string; onClose: () => void }) {
  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(); }} className="space-y-3">
      {children}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={busy}>{busy ? "Salvando…" : submit}</button>
      </div>
    </form>
  );
}

export function ClientModal({ client, onClose }: { client?: Client; onClose: () => void }) {
  const { run } = useStore();
  const [f, setF] = useState({ name: client?.name ?? "", company: client?.company ?? "", email: client?.email ?? "", phone: client?.phone ?? "", notes: client?.notes ?? "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    const ok = await run(() => (client ? api.update("clients", client.id, f) : api.create("clients", f)), client ? "Cliente atualizado" : "Cliente cadastrado");
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal title={client ? "Editar cliente" : "Novo cliente"} onClose={onClose}>
      <Form onSubmit={save} busy={busy} onClose={onClose}>
        <Field label="Nome *"><input className="field" required value={f.name} onChange={set("name")} autoFocus /></Field>
        <Field label="Empresa"><input className="field" value={f.company} onChange={set("company")} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="E-mail"><input className="field" type="email" value={f.email} onChange={set("email")} /></Field>
          <Field label="Telefone"><input className="field" value={f.phone} onChange={set("phone")} /></Field>
        </div>
        <Field label="Observações"><textarea className="field" rows={3} value={f.notes} onChange={set("notes")} /></Field>
      </Form>
    </Modal>
  );
}

export function ProposalModal({ proposal, onClose }: { proposal?: Proposal; onClose: () => void }) {
  const { data, run, filters } = useStore();
  const services = data!.services.filter((s) => s.active);
  const [f, setF] = useState({
    client_id: String(proposal?.client_id ?? filters.clientId ?? ""), service: proposal?.service ?? services[0]?.name ?? "",
    scope: proposal?.scope ?? "", value: proposal?.value ?? services[0]?.default_price ?? 0, deadline: proposal?.deadline ?? "",
    valid_until: proposal?.valid_until ?? "", status: proposal?.status ?? "rascunho",
  });
  const [busy, setBusy] = useState(false);
  const { data: templates } = useApi<Template[]>(proposal ? null : "templates");
  if (!data!.clients.length) return (
    <Modal title="Nova proposta" onClose={onClose}>
      <p className="text-sm text-slate-300">Cadastre um cliente antes de criar uma proposta.</p>
    </Modal>
  );
  const save = async () => {
    if (!f.client_id) return;
    setBusy(true);
    const ok = await run(() => (proposal ? api.update("proposals", proposal.id, f) : api.create("proposals", f)), proposal ? "Proposta atualizada" : "Proposta criada");
    setBusy(false);
    if (ok) onClose();
  };
  const locked = proposal?.status === "aprovada";
  return (
    <Modal title={proposal ? "Editar proposta" : "Nova proposta"} onClose={onClose}>
      <Form onSubmit={save} busy={busy} onClose={onClose}>
        <Field label="Cliente *">
          <select className="field" required value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })}>
            <option value="">Selecione…</option>
            {data!.clients.map((c) => <option key={c.id} value={c.id}>{clientLabel(c)}</option>)}
          </select>
        </Field>
        {!proposal && !!templates?.some((t) => t.active) && (
          <Field label="Modelo" hint="Preenche serviço, valor, escopo, prazo e validade. Você pode ajustar tudo depois.">
            <select className="field" defaultValue="" onChange={(e) => { const t = templates.find((x) => String(x.id) === e.target.value); if (t) setF({ ...f, ...fromTemplate(t) }); }}>
              <option value="">Em branco</option>
              {templates.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Serviço *">
            <select className="field" value={f.service} onChange={(e) => {
              const svc = data!.services.find((s) => s.name === e.target.value);
              setF({ ...f, service: e.target.value, value: proposal || f.value ? f.value : svc?.default_price ?? 0 });
            }}>
              {data!.services.map((s) => <option key={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Valor (R$) *"><MoneyInput cents={f.value} onChange={(value) => setF({ ...f, value })} required disabled={locked} /></Field>
        </div>
        <Field label="Escopo"><textarea className="field" rows={3} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Prazo de entrega"><input className="field" type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Field>
          <Field label="Validade da proposta"><input className="field" type="date" value={f.valid_until} onChange={(e) => setF({ ...f, valid_until: e.target.value })} /></Field>
        </div>
        {!locked && (
          <Field label="Status">
            <select className="field" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Proposal["status"] })}>
              {["rascunho", "enviada", "recusada", "expirada"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
        )}
      </Form>
    </Modal>
  );
}

export function ProjectModal({ onClose }: { onClose: () => void }) {
  const { data, run } = useStore();
  const [f, setF] = useState({ client_id: "", service: data!.services[0]?.name ?? "", name: "", scope: "", deadline: "", owner: data!.settings.owner_name || "Gabriel Ribeiro Silva" });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const ok = await run(() => api.create("projects", f), "Projeto criado");
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal title="Novo projeto" onClose={onClose}>
      <Form onSubmit={save} busy={busy} onClose={onClose}>
        <Field label="Cliente *">
          <select className="field" required value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })}>
            <option value="">Selecione…</option>
            {data!.clients.map((c) => <option key={c.id} value={c.id}>{clientLabel(c)}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Serviço *"><select className="field" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })}>{data!.services.map((s) => <option key={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Prazo"><input className="field" type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Field>
        </div>
        <Field label="Nome do projeto"><input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Responsável"><input className="field" value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} /></Field>
        <Field label="Escopo"><textarea className="field" rows={3} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} /></Field>
      </Form>
    </Modal>
  );
}

export function PaymentModal({ installmentId, onClose }: { installmentId?: number; onClose: () => void }) {
  const { data, run } = useStore();
  const open = data!.installments
    .map((i) => ({ i, left: i.amount - instPaid(data!, i.id) }))
    .filter((x) => x.left > 0)
    .sort((a, b) => a.i.due_date.localeCompare(b.i.due_date));
  const [id, setId] = useState(installmentId ? String(installmentId) : "");
  const sel = open.find((x) => String(x.i.id) === id);
  const [amount, setAmount] = useState(sel?.left ?? 0);
  const [paidAt, setPaidAt] = useState(todayISO());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const clients = new Map(data!.clients.map((c) => [c.id, c]));
  const save = async () => {
    setBusy(true);
    const ok = await run(() => api.post("payments", { installment_id: Number(id), amount, paid_at: paidAt, note }), "Pagamento registrado");
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal title="Registrar pagamento" onClose={onClose}>
      {!open.length ? <p className="text-sm text-slate-300">Não há parcelas em aberto. Aprove uma proposta ou crie uma cobrança avulsa no Financeiro.</p> : (
        <Form onSubmit={save} busy={busy} submit="Registrar" onClose={onClose}>
          <Field label="Parcela *">
            <select className="field" required value={id} onChange={(e) => { setId(e.target.value); setAmount(open.find((x) => String(x.i.id) === e.target.value)?.left ?? 0); }}>
              <option value="">Selecione…</option>
              {open.map(({ i, left }) => <option key={i.id} value={i.id}>{clientLabel(clients.get(i.client_id))} · {i.label} · vence {fmtDate(i.due_date)} · saldo {brl(left)}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor recebido (R$) *" hint={sel ? `Saldo da parcela: ${brl(sel.left)}` : undefined}><MoneyInput cents={amount} onChange={setAmount} required /></Field>
            <Field label="Data do recebimento"><input className="field" type="date" required value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></Field>
          </div>
          <Field label="Observação"><input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: Pix recebido fora da integração" /></Field>
        </Form>
      )}
    </Modal>
  );
}
