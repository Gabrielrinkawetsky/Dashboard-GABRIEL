import PasswordSettings from "../PasswordSettings";
import { useState, type FormEvent } from "react";
import { Copy, Eye, EyeOff, Plus } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { Badge, Card, Field, MoneyInput, PageHeader, Title } from "../ui";
import { brl } from "../lib";
import type { PageProps } from "./shared";

export default function SettingsPage(_: PageProps) {
  const { data, run, notify } = useStore();
  const d = data!;
  const [f, setF] = useState({ company_name: d.settings.company_name ?? "", owner_name: d.settings.owner_name ?? "Gabriel Ribeiro Silva", email: d.settings.email ?? "", phone: d.settings.phone ?? "" });
  const [svc, setSvc] = useState({ name: "", price: 0 });
  const [secret, setSecret] = useState<string | null>(null);
  const hasDemo = d.clients.some((c) => c.demo);
  const hook = `${location.origin}/api/webhooks/payments`;

  const save = (e: FormEvent) => { e.preventDefault(); void run(() => api.put("settings", f), "Configurações salvas"); };
  const addSvc = (e: FormEvent) => {
    e.preventDefault();
    if (!svc.name.trim()) return;
    void run(() => api.create("services", { name: svc.name, default_price: svc.price }), "Serviço adicionado").then((ok) => ok && setSvc({ name: "", price: 0 }));
  };
  const reveal = async () => {
    if (secret) return setSecret(null);
    try { setSecret((await api.secret()).secret); } catch { notify("err", "Não foi possível obter o segredo"); }
  };
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => notify("ok", "Copiado"));

  return (
    <>
      <PageHeader title="Configurações" />
      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <PasswordSettings />
        <Card>
          <Title>Dados da empresa</Title>
          <form onSubmit={save} className="space-y-3">
            <Field label="Nome da empresa"><input className="field" value={f.company_name} onChange={(e) => setF({ ...f, company_name: e.target.value })} /></Field>
            <Field label="Responsável"><input className="field" value={f.owner_name} onChange={(e) => setF({ ...f, owner_name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="E-mail"><input className="field" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
              <Field label="Telefone"><input className="field" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            </div>
            <button className="btn btn-primary">Salvar</button>
          </form>
        </Card>

        <Card>
          <Title>Serviços</Title>
          <ul className="mb-3 divide-y divide-white/5">
            {d.services.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                <span className={s.active ? "" : "text-slate-500 line-through"}>{s.name} <span className="text-slate-500">· {brl(s.default_price)}</span></span>
                <button className="btn !px-2.5 !py-1" onClick={() => void run(() => api.update("services", s.id, { active: s.active ? 0 : 1 }))}>{s.active ? "Desativar" : "Ativar"}</button>
              </li>
            ))}
          </ul>
          <form onSubmit={addSvc} className="flex flex-wrap items-end gap-2">
            <div className="min-w-40 flex-1"><Field label="Novo serviço"><input className="field" value={svc.name} onChange={(e) => setSvc({ ...svc, name: e.target.value })} /></Field></div>
            <div className="w-36"><Field label="Preço padrão"><MoneyInput cents={svc.price} onChange={(price) => setSvc({ ...svc, price })} /></Field></div>
            <button className="btn"><Plus className="h-4 w-4" /> Adicionar</button>
          </form>
        </Card>

        <Card>
          <Title action={<Badge tone="warn">Provedor não conectado</Badge>}>Integração de pagamentos</Title>
          <p className="mb-3 text-sm text-slate-400">
            O painel já recebe confirmações, cancelamentos e estornos por webhook, sem contar o mesmo evento duas vezes. Nenhum provedor de cobrança está conectado ainda:
            quando você escolher o meio de recebimento, o provedor deve enviar os eventos para o endereço abaixo.
          </p>
          <Field label="URL do webhook">
            <div className="flex gap-2"><input className="field" readOnly value={hook} /><button type="button" className="btn" aria-label="Copiar URL" onClick={() => void copy(hook)}><Copy className="h-4 w-4" /></button></div>
          </Field>
          <div className="mt-3"><Field label="Segredo (cabeçalho x-webhook-secret)" hint="Fica só no servidor (arquivo .env). Não compartilhe.">
            <div className="flex gap-2">
              <input className="field font-mono" readOnly value={secret ?? "••••••••••••••••"} />
              <button type="button" className="btn" aria-label={secret ? "Ocultar" : "Mostrar"} onClick={() => void reveal()}>{secret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
              {secret && <button type="button" className="btn" aria-label="Copiar segredo" onClick={() => void copy(secret)}><Copy className="h-4 w-4" /></button>}
            </div>
          </Field></div>
          <pre className="mt-3 overflow-x-auto rounded-xl bg-black/30 p-3 text-xs text-slate-300">{`POST /api/webhooks/payments
{ "provider": "nome", "event_id": "único por evento",
  "type": "payment.confirmed | payment.refunded | payment.canceled",
  "payment_id": "id do pagamento", "installment_id": 12,
  "amount": 50000 /* centavos */, "paid_at": "2026-10-05" }`}</pre>
        </Card>

        <Card>
          <Title>Dados de exemplo</Title>
          <p className="mb-3 text-sm text-slate-400">Os registros de demonstração são marcados com a etiqueta “Exemplo” e podem ser removidos antes de usar o painel de verdade. Seus dados reais não são afetados.</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn" disabled={hasDemo} onClick={() => void run(() => api.post("demo"), "Dados de exemplo carregados")}>Carregar exemplos</button>
            <button className="btn btn-danger" disabled={!hasDemo} onClick={() => { if (confirm("Remover todos os dados de exemplo?")) void run(() => api.del("demo"), "Dados de exemplo removidos"); }}>Remover exemplos</button>
          </div>
        </Card>
      </div>
    </>
  );
}
