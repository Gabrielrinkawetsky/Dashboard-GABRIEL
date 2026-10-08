import { useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { useApi } from "../useApi";
import { Badge, Card, Empty, Field, Modal, MoneyInput, Title } from "../ui";
import { brl } from "../lib";
import type { Template } from "../templates";

const blank = { name: "", service: "", scope: "", deliverables: "", exclusions: "", payment_terms: "", price: 0, revisions: 2, deadline_days: 15, validity_days: 7, active: 1 };

function TemplateModal({ template, onClose, onSaved }: { template?: Template; onClose: () => void; onSaved: () => void }) {
  const { data, run } = useStore();
  const [f, setF] = useState(template ? { ...blank, ...template, scope: template.scope ?? "", deliverables: template.deliverables ?? "", exclusions: template.exclusions ?? "", payment_terms: template.payment_terms ?? "" } : { ...blank, service: data!.services[0]?.name ?? "" });
  const [busy, setBusy] = useState(false);
  const num = (k: "revisions" | "deadline_days" | "validity_days", min: number) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: Math.max(min, Math.floor(Number(e.target.value) || 0)) });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const body = { name: f.name, service: f.service, scope: f.scope, deliverables: f.deliverables, exclusions: f.exclusions, payment_terms: f.payment_terms, price: f.price, revisions: f.revisions, deadline_days: f.deadline_days, validity_days: f.validity_days, active: f.active };
    const ok = await run(() => (template ? api.update("templates", template.id, body) : api.create("templates", body)), template ? "Modelo atualizado" : "Modelo criado");
    setBusy(false);
    if (ok) { onSaved(); onClose(); }
  };
  return (
    <Modal title={template ? "Editar modelo" : "Novo modelo"} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome do modelo *"><input className="field" required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Serviço *">
            <input className="field" required maxLength={80} list="svc-list" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })} />
            <datalist id="svc-list">{data!.services.map((s) => <option key={s.id} value={s.name} />)}</datalist>
          </Field>
        </div>
        <Field label="Escopo"><textarea className="field" rows={3} maxLength={1800} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Entregáveis" hint="Um item por linha"><textarea className="field" rows={4} maxLength={1800} value={f.deliverables} onChange={(e) => setF({ ...f, deliverables: e.target.value })} /></Field>
          <Field label="Exclusões (o que não está incluído)" hint="Um item por linha"><textarea className="field" rows={4} maxLength={1800} value={f.exclusions} onChange={(e) => setF({ ...f, exclusions: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Valor (R$) *"><MoneyInput cents={f.price} onChange={(price) => setF({ ...f, price })} required /></Field>
          <Field label="Revisões"><input className="field" type="number" min={0} max={50} value={f.revisions} onChange={num("revisions", 0)} /></Field>
          <Field label="Prazo (dias)"><input className="field" type="number" min={1} max={730} value={f.deadline_days} onChange={num("deadline_days", 1)} /></Field>
          <Field label="Validade (dias)"><input className="field" type="number" min={1} max={365} value={f.validity_days} onChange={num("validity_days", 1)} /></Field>
        </div>
        <Field label="Condições de pagamento"><textarea className="field" rows={2} maxLength={1000} value={f.payment_terms} onChange={(e) => setF({ ...f, payment_terms: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.active} onChange={(e) => setF({ ...f, active: e.target.checked ? 1 : 0 })} /> Modelo ativo (aparece ao criar propostas)</label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function TemplatesCard() {
  const { run } = useStore();
  const { data, error, loading, reload } = useApi<Template[]>("templates");
  const [edit, setEdit] = useState<Template | "new" | null>(null);
  const remove = async (t: Template) => {
    if (!window.confirm(`Apagar o modelo "${t.name}"? As propostas já criadas não mudam.`)) return;
    if (await run(() => api.del(`templates/${t.id}`), "Modelo apagado")) void reload();
  };
  return (
    <Card className="xl:col-span-2">
      <Title action={<button className="btn" onClick={() => setEdit("new")}><Plus className="h-4 w-4" /> Novo modelo</button>}>Modelos de proposta e contrato</Title>
      <p className="mb-3 text-sm text-slate-400">Ao criar uma proposta, escolha um modelo e o escopo, entregáveis, exclusões, revisões, prazo, valor e pagamento já vêm preenchidos para você ajustar.</p>
      {error ? <p className="text-sm text-rose-300" role="alert">{error}</p> : loading && !data ? <p className="text-sm text-slate-500">Carregando…</p> : !data?.length ? <Empty title="Nenhum modelo" text="Crie um modelo para agilizar suas propostas." /> : (
        <ul className="divide-y divide-white/5">
          {data.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{t.name} {!t.active && <Badge>Inativo</Badge>}</p>
                <p className="text-xs text-slate-500">{t.service} · {brl(t.price)} · {t.deadline_days} dia(s) · {t.revisions} revisão(ões)</p>
              </div>
              <button className="btn" aria-label={`Editar modelo ${t.name}`} onClick={() => setEdit(t)}><Pencil className="h-4 w-4" /></button>
              <button className="btn" aria-label={`Apagar modelo ${t.name}`} onClick={() => void remove(t)}><Trash2 className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      )}
      {edit && <TemplateModal template={edit === "new" ? undefined : edit} onClose={() => setEdit(null)} onSaved={() => void reload()} />}
    </Card>
  );
}
