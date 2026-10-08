// Integração com o Asaas (https://docs.asaas.com): cria clientes e cobranças e aplica o status das cobranças no financeiro.
// Configuração: ASAAS_API_KEY (obrigatória), ASAAS_WEBHOOK_TOKEN (para receber eventos) e, opcional, ASAAS_ENV=sandbox|production.
import { db, tx } from "./db.js";
import { today } from "./dates.js";
import { Invalid } from "./validate.js";

const key = () => process.env.ASAAS_API_KEY || "";
// Chaves de sandbox começam com $aact_hmlg_; sem ASAAS_ENV, o ambiente é deduzido pela chave.
export const asaasEnv = () => process.env.ASAAS_ENV || (key().startsWith("$aact_hmlg_") ? "sandbox" : "production");
const baseUrl = () => process.env.ASAAS_API_URL || (asaasEnv() === "sandbox" ? "https://api-sandbox.asaas.com/v3" : "https://api.asaas.com/v3");
export const asaasConfigured = () => Boolean(key());

/** Chamada à API. Erros do Asaas viram mensagem legível (código 502: a falha é do serviço externo ou dos dados enviados a ele). */
async function call(method, path, body) {
  if (!asaasConfigured()) throw new Invalid("Asaas não configurado (ASAAS_API_KEY)", 503);
  let res;
  try {
    res = await fetch(baseUrl() + path, {
      method,
      headers: { access_token: key(), "Content-Type": "application/json", "User-Agent": "dashboard-gabriel" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Invalid("Não foi possível falar com o Asaas. Tente de novo.", 502);
  }
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Invalid("Asaas recusou a chave de API (ASAAS_API_KEY)", 502);
  if (!res.ok) throw new Invalid(`Asaas: ${json.errors?.map((e) => e.description).join("; ") || `erro ${res.status}`}`, 502);
  return json;
}

const cents = (reais) => Math.round(Number(reais) * 100);
const net = async (installmentId) =>
  (await db.prepare("SELECT COALESCE(SUM(CASE WHEN type='refund' THEN -amount ELSE amount END),0) AS n FROM payments WHERE installment_id=?").get(installmentId)).n;

/** Cliente no Asaas (cria uma vez e guarda o id). Reaproveita um cliente criado antes pelo painel (externalReference). */
async function ensureCustomer(client) {
  if (client.asaas_customer_id) return client.asaas_customer_id;
  if (!client.cpf_cnpj) throw new Invalid("Cadastre o CPF ou CNPJ do cliente antes de cobrar pelo Asaas");
  const ref = `cliente-${client.id}`;
  const found = await call("GET", `/customers?externalReference=${encodeURIComponent(ref)}&limit=1`);
  let id = found.data?.[0]?.id;
  if (!id) {
    const phone = (client.phone ?? "").replace(/\D/g, "");
    id = (await call("POST", "/customers", {
      name: client.cpf_cnpj.length === 14 && client.company ? client.company : client.name,
      cpfCnpj: client.cpf_cnpj, email: client.email || undefined, mobilePhone: phone.length >= 10 ? phone : undefined,
      company: client.company || undefined, externalReference: ref,
    })).id;
  }
  await db.prepare("UPDATE clients SET asaas_customer_id=? WHERE id=?").run(id, client.id);
  return id;
}

/** Cria a cobrança do saldo em aberto da parcela. O cliente escolhe PIX, boleto ou cartão na página do Asaas. */
export async function createCharge(installmentId) {
  const inst = await db.prepare("SELECT * FROM installments WHERE id=?").get(installmentId);
  if (!inst) throw new Invalid("Parcela não encontrada", 404);
  if (inst.asaas_payment_id) throw new Invalid("Esta parcela já tem cobrança no Asaas", 409);
  const open = inst.amount - await net(inst.id);
  if (open <= 0) throw new Invalid("Parcela já está paga");
  const client = await db.prepare("SELECT * FROM clients WHERE id=?").get(inst.client_id);
  // Reserva a parcela antes de chamar o Asaas: dois cliques seguidos não criam duas cobranças.
  const claim = `pendente-${inst.id}`;
  if (!(await db.prepare("UPDATE installments SET asaas_payment_id=? WHERE id=? AND asaas_payment_id IS NULL").run(claim, inst.id)).changes)
    throw new Invalid("Esta parcela já tem cobrança no Asaas", 409);
  try {
    const customer = await ensureCustomer(client);
    const due = inst.due_date > today() ? inst.due_date : today(); // o Asaas não aceita vencimento no passado
    const p = await call("POST", "/payments", {
      customer, billingType: "UNDEFINED", value: open / 100, dueDate: due,
      description: [inst.label, client.company || client.name].filter(Boolean).join(" · ").slice(0, 500),
      externalReference: `parcela-${inst.id}`,
    });
    await db.prepare("UPDATE installments SET asaas_payment_id=?, asaas_invoice_url=?, asaas_status=? WHERE id=?").run(p.id, p.invoiceUrl ?? null, p.status ?? null, inst.id);
    return { invoiceUrl: p.invoiceUrl };
  } catch (e) {
    await db.prepare("UPDATE installments SET asaas_payment_id=NULL WHERE id=? AND asaas_payment_id=?").run(inst.id, claim);
    throw e;
  }
}

/** Cancela (exclui) a cobrança no Asaas e libera a parcela para uma nova cobrança. Só para cobranças ainda não pagas. */
export async function cancelCharge(installmentId) {
  const inst = await db.prepare("SELECT * FROM installments WHERE id=?").get(installmentId);
  if (!inst?.asaas_payment_id || inst.asaas_payment_id.startsWith("pendente-")) throw new Invalid("Esta parcela não tem cobrança no Asaas", 404);
  if (await db.prepare("SELECT 1 FROM payments WHERE source='asaas' AND external_id=? AND type='payment'").get(inst.asaas_payment_id))
    throw new Invalid("Cobrança já paga: faça o estorno pelo Asaas", 409);
  await call("DELETE", `/payments/${encodeURIComponent(inst.asaas_payment_id)}`);
  await db.prepare("UPDATE installments SET asaas_payment_id=NULL, asaas_invoice_url=NULL, asaas_status=NULL WHERE id=?").run(inst.id);
}

export const fetchPayment = (id) => call("GET", `/payments/${encodeURIComponent(id)}`);

const PAID = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"];
const REFUNDED = ["REFUNDED"];

/**
 * Aplica o estado atual de uma cobrança do Asaas no financeiro (idempotente: pode rodar várias vezes com o mesmo dado).
 * Pago → um lançamento "asaas" com o valor efetivamente cobrado (inclui juros/multa). Estornado → estorno do que falta estornar.
 * Excluída no Asaas → a parcela fica livre para nova cobrança. Retorna o que foi feito, para log e resposta.
 */
export function applyPayment(p) {
  return tx(async () => {
    const ref = /^parcela-(\d{1,15})$/.exec(p.externalReference ?? "")?.[1];
    const inst = await db.prepare("SELECT * FROM installments WHERE asaas_payment_id=?").get(p.id)
      ?? (ref ? await db.prepare("SELECT * FROM installments WHERE id=? AND (asaas_payment_id IS NULL OR asaas_payment_id LIKE 'pendente-%')").get(Number(ref)) : undefined);
    if (!inst) return "ignorado: cobrança não criada pelo painel";
    if (p.deleted) {
      const paid = await db.prepare("SELECT 1 FROM payments WHERE source='asaas' AND external_id=?").get(p.id);
      if (!paid) await db.prepare("UPDATE installments SET asaas_payment_id=NULL, asaas_invoice_url=NULL, asaas_status=NULL WHERE id=?").run(inst.id);
      else await db.prepare("UPDATE installments SET asaas_status='DELETED' WHERE id=?").run(inst.id);
      return "cobrança excluída no Asaas";
    }
    await db.prepare("UPDATE installments SET asaas_payment_id=?, asaas_invoice_url=COALESCE(?, asaas_invoice_url), asaas_status=? WHERE id=?")
      .run(p.id, p.invoiceUrl ?? null, p.status ?? null, inst.id);
    const paidAt = [p.paymentDate, p.clientPaymentDate, p.confirmedDate].find((d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? "")) ?? today();
    const amount = cents(p.value);
    if (!(amount > 0)) return "ignorado: valor inválido";
    let done = "status atualizado";
    if (PAID.includes(p.status) || REFUNDED.includes(p.status)) {
      const r = await db.prepare("INSERT OR IGNORE INTO payments (installment_id, client_id, project_id, amount, type, paid_at, source, external_id, note) VALUES (?,?,?,?, 'payment', ?, 'asaas', ?, ?)")
        .run(inst.id, inst.client_id, inst.project_id, amount, paidAt, p.id, `Pago pelo Asaas${p.billingType ? ` (${p.billingType})` : ""}`);
      if (r.changes) done = "pagamento registrado";
    }
    if (REFUNDED.includes(p.status)) {
      // Estorno total: um único lançamento por cobrança (o índice único impede duplicar).
      const orig = await db.prepare("SELECT amount FROM payments WHERE source='asaas' AND external_id=? AND type='payment'").get(p.id);
      const r = await db.prepare("INSERT OR IGNORE INTO payments (installment_id, client_id, project_id, amount, type, paid_at, source, external_id, note) VALUES (?,?,?,?, 'refund', ?, 'asaas', ?, ?)")
        .run(inst.id, inst.client_id, inst.project_id, orig.amount, today(), `${p.id}:estorno`, "Estornado no Asaas");
      if (r.changes) done = "estorno registrado";
    }
    return done;
  });
}

/** Busca a cobrança no Asaas e aplica (botão "Atualizar" e conferência do webhook). */
export async function syncInstallment(installmentId) {
  const inst = await db.prepare("SELECT asaas_payment_id FROM installments WHERE id=?").get(installmentId);
  if (!inst?.asaas_payment_id || inst.asaas_payment_id.startsWith("pendente-")) throw new Invalid("Esta parcela não tem cobrança no Asaas", 404);
  return applyPayment(await fetchPayment(inst.asaas_payment_id));
}
