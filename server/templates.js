// Modelos de proposta/contrato: escopo, entregáveis, exclusões, revisões, prazo, valor e condições de pagamento.
import { Router } from "express";
import { db } from "./db.js";
import { Invalid, bool01, int, isPlainObject, money, text } from "./validate.js";

export const templatesRouter = Router();

const DEFAULTS = [
  {
    name: "Landing page", service: "Landing page", price: 150000, revisions: 2, deadline_days: 10, validity_days: 7,
    scope: "Criação de uma página única, responsiva, focada em conversão, com identidade visual do cliente.",
    deliverables: "Design da página (desktop e celular)\nDesenvolvimento e publicação\nFormulário de contato com envio por e-mail\nConfiguração básica de SEO e métricas",
    exclusions: "Produção de textos e fotos\nCriação de logotipo\nGestão de anúncios\nHospedagem e domínio (podem ser contratados à parte)",
    payment_terms: "50% na aprovação da proposta e 50% na entrega, via Pix ou transferência.",
  },
  {
    name: "E-commerce", service: "E-commerce", price: 450000, revisions: 3, deadline_days: 30, validity_days: 10,
    scope: "Loja virtual completa com catálogo, carrinho, checkout e painel de gestão de pedidos.",
    deliverables: "Design da loja (desktop e celular)\nCadastro inicial de até 30 produtos\nIntegração com meio de pagamento\nConfiguração de frete\nTreinamento de uso do painel",
    exclusions: "Fotografia dos produtos\nCadastro de produtos além do combinado\nGestão de anúncios e redes sociais\nTaxas dos meios de pagamento e da plataforma",
    payment_terms: "40% na aprovação, 30% na aprovação do layout e 30% na entrega.",
  },
  {
    name: "Site institucional", service: "Site institucional", price: 250000, revisions: 2, deadline_days: 20, validity_days: 7,
    scope: "Site com várias páginas (início, sobre, serviços, contato) apresentando a empresa.",
    deliverables: "Design das páginas (desktop e celular)\nDesenvolvimento e publicação\nFormulário de contato\nConfiguração básica de SEO",
    exclusions: "Produção de textos, fotos e vídeos\nCriação de logotipo\nBlog com publicação de conteúdo recorrente\nHospedagem e domínio",
    payment_terms: "50% na aprovação da proposta e 50% na entrega.",
  },
  {
    name: "Manutenção mensal", service: "Manutenção e suporte", price: 15000, revisions: 1, deadline_days: 5, validity_days: 7,
    scope: "Manutenção contínua do site: atualizações, correções e suporte técnico.",
    deliverables: "Atualizações de segurança e de conteúdo simples\nCorreção de falhas\nBackup periódico\nSuporte por e-mail ou WhatsApp em horário comercial",
    exclusions: "Novas páginas ou funcionalidades (orçadas à parte)\nRedesign completo\nCusto de hospedagem e domínio",
    payment_terms: "Mensalidade paga até o dia 5 de cada mês, via Pix ou boleto.",
  },
];

let seeding = null;
/** Cria os 4 modelos padrão uma única vez (apagar um modelo depois não o recria). */
function seedOnce() {
  seeding ??= (async () => {
    if ((await db.prepare("SELECT value FROM settings WHERE key = 'templates_seeded'").get())) return;
    if (!(await db.prepare("SELECT 1 FROM proposal_templates LIMIT 1").get())) {
      for (const t of DEFAULTS) {
        await db.prepare("INSERT INTO proposal_templates (name, service, scope, deliverables, exclusions, revisions, deadline_days, validity_days, payment_terms, price) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .run(t.name, t.service, t.scope, t.deliverables, t.exclusions, t.revisions, t.deadline_days, t.validity_days, t.payment_terms, t.price);
      }
    }
    await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('templates_seeded', '1')").run();
  })().catch((e) => { seeding = null; throw e; });
  return seeding;
}

const fail = (res, code, error) => res.status(code).json({ error });
const handle = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    if (Number.isInteger(e?.code) && e.code >= 400 && e.code < 600) return fail(res, e.code, e.message);
    console.error(`[modelos] ${req.method} ${req.path}:`, e?.message ?? e);
    fail(res, 500, "Erro ao processar. Tente novamente.");
  }
};

function parse(body, partial = false) {
  if (!isPlainObject(body)) throw new Invalid("Corpo inválido");
  const allowed = ["name", "service", "scope", "deliverables", "exclusions", "revisions", "deadline_days", "validity_days", "payment_terms", "price", "active"];
  for (const k of Object.keys(body)) if (!allowed.includes(k)) throw new Invalid(`Campo desconhecido: ${k}`);
  const out = {};
  const has = (k) => !partial || k in body;
  if (has("name")) out.name = text(body.name, "nome", 80, true);
  if (has("service")) out.service = text(body.service, "serviço", 80, true);
  if (has("scope")) out.scope = text(body.scope, "escopo", 1800);
  if (has("deliverables")) out.deliverables = text(body.deliverables, "entregáveis", 1800);
  if (has("exclusions")) out.exclusions = text(body.exclusions, "exclusões", 1800);
  if (has("payment_terms")) out.payment_terms = text(body.payment_terms, "condições de pagamento", 1000);
  if (has("revisions")) out.revisions = int(body.revisions ?? 2, "revisões", { min: 0, max: 50 });
  if (has("deadline_days")) out.deadline_days = int(body.deadline_days ?? 15, "prazo (dias)", { min: 1, max: 730 });
  if (has("validity_days")) out.validity_days = int(body.validity_days ?? 7, "validade (dias)", { min: 1, max: 365 });
  if (has("price")) out.price = body.price === 0 || body.price === "0" ? 0 : money(body.price ?? 0, "valor");
  if ("active" in body) out.active = bool01(body.active, "ativo");
  return out;
}

const idOf = (req) => {
  if (!/^\d{1,15}$/.test(req.params.id)) throw new Invalid("Modelo não encontrado", 404);
  return Number(req.params.id);
};

templatesRouter.get("/", handle(async (_req, res) => {
  await seedOnce();
  res.json(await db.prepare("SELECT * FROM proposal_templates ORDER BY active DESC, name, id").all());
}));

templatesRouter.post("/", handle(async (req, res) => {
  const t = parse(req.body);
  const r = await db.prepare("INSERT INTO proposal_templates (name, service, scope, deliverables, exclusions, revisions, deadline_days, validity_days, payment_terms, price) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(t.name, t.service, t.scope, t.deliverables, t.exclusions, t.revisions, t.deadline_days, t.validity_days, t.payment_terms, t.price);
  res.status(201).json(await db.prepare("SELECT * FROM proposal_templates WHERE id = ?").get(Number(r.lastInsertRowid)));
}));

templatesRouter.patch("/:id", handle(async (req, res) => {
  const id = idOf(req);
  if (!(await db.prepare("SELECT 1 FROM proposal_templates WHERE id = ?").get(id))) throw new Invalid("Modelo não encontrado", 404);
  const t = parse(req.body, true);
  const keys = Object.keys(t);
  if (!keys.length) throw new Invalid("Nada para atualizar");
  await db.prepare(`UPDATE proposal_templates SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => t[k]), id);
  res.json(await db.prepare("SELECT * FROM proposal_templates WHERE id = ?").get(id));
}));

templatesRouter.delete("/:id", handle(async (req, res) => {
  const id = idOf(req);
  const r = await db.prepare("DELETE FROM proposal_templates WHERE id = ?").run(id);
  if (!r.changes) throw new Invalid("Modelo não encontrado", 404);
  res.json({ ok: true });
}));
