// Funil de vendas: oportunidades (leads), etapas, conversão em cliente e captura pública por formulário.
import { Router } from "express";
import { db, tx } from "./db.js";
import { today } from "./dates.js";
import { Invalid, date, email, int, isPlainObject, money, oneOf, text } from "./validate.js";
import { runList } from "./list.js";

export const OPP_STAGES = ["Novo lead", "Contato iniciado", "Reunião/briefing", "Proposta enviada", "Negociação", "Ganho", "Perdido"];
export const OPEN_STAGES = OPP_STAGES.slice(0, 5);
export const SOURCES = ["Formulário do site", "Indicação", "Instagram", "WhatsApp", "Google", "LinkedIn", "Evento", "Outro"];

const fail = (res, code, error) => res.status(code).json({ error });
const isHttpCode = (c) => Number.isInteger(c) && c >= 400 && c < 600;
/** Executa o handler e traduz erros de validação (código HTTP numérico) em respostas; o resto vira 500 genérico. */
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    if (isHttpCode(e?.code)) return fail(res, e.code, e.message);
    console.error(`[funil] ${req.method} ${req.path}:`, e?.message ?? e);
    fail(res, 500, "Erro ao processar. Tente novamente.");
  }
};
const idOf = (req) => {
  if (!/^\d{1,15}$/.test(req.params.id)) throw new Invalid("Oportunidade não encontrada", 404);
  return Number(req.params.id);
};
const nameText = (v) => {
  const s = text(v, "nome", 120, true);
  if (s.length < 2) throw new Invalid("nome: use ao menos 2 letras");
  return s;
};
/** Telefone brasileiro só com dígitos, sem o 55 do país (para comparar duplicados). */
/** Texto comparável: sem acentos, minúsculo e sem espaços nas pontas ("Empresa Única" == "EMPRESA unica"). */
const fold = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const digits = (s) => String(s ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
const phoneText = (v) => {
  const s = text(v, "telefone", 40);
  if (s !== null && !/^[\d\s()+.\-]{8,40}$/.test(s)) throw new Invalid("telefone: use apenas números, espaços e ()+-.");
  if (s !== null && (digits(s).length < 8 || digits(s).length > 13)) throw new Invalid("telefone: quantidade de dígitos inválida");
  return s;
};

const FIELDS = {
  name: nameText,
  company: (v) => text(v, "empresa", 120),
  email: (v) => email(v),
  phone: phoneText,
  source: (v) => oneOf(v, "origem", SOURCES),
  service: (v) => text(v, "serviço", 80),
  value: (v) => int(v, "valor estimado", { min: 0, max: 100_000_000_000 }) ?? 0,
  next_contact: (v) => date(v, "próximo contato"),
  owner: (v) => text(v, "responsável", 120),
  notes: (v) => text(v, "observações", 4000),
};

const logEvent = (d, id, message) => d.prepare("INSERT INTO opportunity_events (opportunity_id, text) VALUES (?,?)").run(id, message);

/** Vincula a oportunidade a um cliente: reaproveita um existente (e-mail, telefone ou empresa) ou cria um novo, nunca duplica. */
async function convertToClient(d, opp) {
  if (opp.client_id) return { client_id: opp.client_id, created: false, matched_by: "vinculado" };
  let found = null;
  let by = null;
  if (opp.email) { found = await d.prepare("SELECT id FROM clients WHERE lower(email) = lower(?) ORDER BY id LIMIT 1").get(opp.email); by = "e-mail"; }
  if (!found && opp.phone && digits(opp.phone).length >= 8) {
    const n = digits(opp.phone);
    const rows = await d.prepare("SELECT id, phone FROM clients WHERE phone IS NOT NULL AND phone <> '' ORDER BY id LIMIT 5000").all();
    found = rows.find((r) => digits(r.phone) === n) ?? null;
    by = "telefone";
  }
  if (!found && fold(opp.company)) {
    const rows = await d.prepare("SELECT id, company FROM clients WHERE company IS NOT NULL AND company <> '' ORDER BY id LIMIT 5000").all();
    found = rows.find((r) => fold(r.company) === fold(opp.company)) ?? null;
    by = "empresa";
  }
  if (found) {
    await d.prepare("UPDATE opportunities SET client_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(found.id, opp.id);
    await logEvent(d, opp.id, `Vinculada ao cliente existente #${found.id} (mesmo ${by}); nenhum cliente duplicado.`);
    return { client_id: found.id, created: false, matched_by: by };
  }
  const id = Number((await d.prepare("INSERT INTO clients (name, company, email, phone, notes) VALUES (?,?,?,?,?)")
    .run(opp.name, opp.company, opp.email, opp.phone, `Origem: oportunidade #${opp.id}${opp.source ? ` (${opp.source})` : ""}`)).lastInsertRowid);
  await d.prepare("UPDATE opportunities SET client_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id, opp.id);
  await logEvent(d, opp.id, `Convertida em novo cliente #${id}.`);
  return { client_id: id, created: true, matched_by: null };
}

const LIST_SPEC = {
  table: "opportunities",
  sort: {
    atualizado: "updated_at",
    criado: "created_at",
    nome: "name COLLATE NOCASE",
    valor: "value",
    proximo_contato: "CASE WHEN next_contact IS NULL THEN 1 ELSE 0 END, next_contact",
    etapa: "stage",
  },
  defaultSort: "atualizado",
  search: ["name", "company", "email", "phone", "notes"],
  filters: { stage: "stage", source: "source", service: "service", owner: "owner" },
  extra: (q) => (q.aberta === "1" ? { sql: `stage IN (${OPEN_STAGES.map(() => "?").join(",")})`, params: OPEN_STAGES } : null),
};

// ---------------------------------------------------------------------------------------------------------
// Rotas autenticadas (a sessão já foi exigida em server/index.js antes de montar este roteador)
// ---------------------------------------------------------------------------------------------------------
export const opportunitiesRouter = Router();

opportunitiesRouter.get("/", wrap(async (req, res) => res.json(await runList(db, LIST_SPEC, req.query))));

// Quadro: por etapa aberta, totais e os primeiros cartões; e o resumo de ganhos/perdidos dos últimos 90 dias.
opportunitiesRouter.get("/board", wrap(async (_req, res) => {
  const stages = [];
  for (const stage of OPEN_STAGES) {
    const sum = await db.prepare("SELECT count(*) AS n, COALESCE(SUM(value),0) AS v FROM opportunities WHERE stage=?").get(stage);
    const items = await db.prepare(
      "SELECT * FROM opportunities WHERE stage=? ORDER BY CASE WHEN next_contact IS NULL THEN 1 ELSE 0 END, next_contact, updated_at DESC, id DESC LIMIT 40",
    ).all(stage);
    stages.push({ stage, total: Number(sum.n), value: Number(sum.v), items });
  }
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const closed = await db.prepare(
    "SELECT stage, count(*) AS n, COALESCE(SUM(value),0) AS v FROM opportunities WHERE stage IN ('Ganho','Perdido') AND closed_at >= ? GROUP BY stage",
  ).all(since);
  const pick = (s) => { const r = closed.find((c) => c.stage === s); return { total: Number(r?.n ?? 0), value: Number(r?.v ?? 0) }; };
  res.json({ stages, won: pick("Ganho"), lost: pick("Perdido"), sinceDays: 90 });
}));

opportunitiesRouter.get("/meta", (_req, res) => res.json({ stages: OPP_STAGES, openStages: OPEN_STAGES, sources: SOURCES }));

opportunitiesRouter.get("/:id", wrap(async (req, res) => {
  const id = idOf(req);
  const opp = await db.prepare("SELECT * FROM opportunities WHERE id=?").get(id);
  if (!opp) throw new Invalid("Oportunidade não encontrada", 404);
  const events = await db.prepare("SELECT id, at, text FROM opportunity_events WHERE opportunity_id=? ORDER BY id DESC LIMIT 200").all(id);
  const client = opp.client_id ? await db.prepare("SELECT id, name, company FROM clients WHERE id=?").get(opp.client_id) : null;
  const proposal = opp.proposal_id ? await db.prepare("SELECT id, status, value, service FROM proposals WHERE id=?").get(opp.proposal_id) : null;
  res.json({ ...opp, events, client, proposal });
}));

const parseFields = (body, partial) => {
  if (!isPlainObject(body)) throw new Invalid("Corpo JSON inválido");
  const out = {};
  for (const [k, parse] of Object.entries(FIELDS)) if (Object.hasOwn(body, k)) out[k] = parse(body[k]);
  if (!partial && !out.name) throw new Invalid("Campo obrigatório: nome");
  if ("name" in out && out.name === null) throw new Invalid("Campo obrigatório: nome");
  if ("value" in out && out.value === null) out.value = 0;
  return out;
};

opportunitiesRouter.post("/", wrap(async (req, res) => {
  const f = parseFields(req.body, false);
  if (!f.email && !f.phone) throw new Invalid("Informe ao menos um e-mail ou telefone para contato");
  const ownerSetting = (await db.prepare("SELECT value FROM settings WHERE key='owner_name'").get())?.value;
  const row = { source: "Outro", value: 0, owner: ownerSetting || null, ...f };
  const id = await tx(async (d) => {
    const newId = Number((await d.prepare(
      "INSERT INTO opportunities (name, company, email, phone, source, service, value, next_contact, owner, notes) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ).run(row.name, row.company ?? null, row.email ?? null, row.phone ?? null, row.source, row.service ?? null, row.value, row.next_contact ?? null, row.owner, row.notes ?? null)).lastInsertRowid);
    await logEvent(d, newId, `Oportunidade criada (${row.source}).`);
    return newId;
  });
  res.status(201).json({ id });
}));

opportunitiesRouter.patch("/:id", wrap(async (req, res) => {
  const id = idOf(req);
  const f = parseFields(req.body, true);
  const keys = Object.keys(f);
  if (!keys.length) return res.json({ ok: true });
  await tx(async (d) => {
    const before = await d.prepare("SELECT * FROM opportunities WHERE id=?").get(id);
    if (!before) throw new Invalid("Oportunidade não encontrada", 404);
    const merged = { ...before, ...f };
    if (!merged.email && !merged.phone) throw new Invalid("Mantenha ao menos um e-mail ou telefone para contato");
    await d.prepare(`UPDATE opportunities SET ${keys.map((k) => `${k}=?`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...keys.map((k) => f[k]), id);
    const changed = keys.filter((k) => String(before[k] ?? "") !== String(f[k] ?? ""));
    if (changed.length) await logEvent(d, id, `Dados atualizados: ${changed.join(", ")}.`);
  });
  res.json({ ok: true });
}));

opportunitiesRouter.post("/:id/move", wrap(async (req, res) => {
  const id = idOf(req);
  const b = isPlainObject(req.body) ? req.body : {};
  const stage = oneOf(b.stage, "etapa", OPP_STAGES, true);
  const lostReason = stage === "Perdido" ? text(b.lost_reason, "motivo da perda", 300, true) : null;
  const result = await tx(async (d) => {
    const opp = await d.prepare("SELECT * FROM opportunities WHERE id=?").get(id);
    if (!opp) throw new Invalid("Oportunidade não encontrada", 404);
    if (opp.stage === stage) return { moved: false, stage };
    let conversion = null;
    if (stage === "Ganho") conversion = await convertToClient(d, opp); // ganho sempre vira cliente (sem duplicar)
    const closing = stage === "Ganho" || stage === "Perdido";
    await d.prepare("UPDATE opportunities SET stage=?, lost_reason=?, closed_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(stage, lostReason, closing ? today() : null, id);
    await logEvent(d, id, `Etapa: ${opp.stage} → ${stage}${lostReason ? ` (motivo: ${lostReason})` : ""}.`);
    return { moved: true, stage, conversion };
  });
  res.json({ ok: true, ...result });
}));

opportunitiesRouter.post("/:id/notes", wrap(async (req, res) => {
  const id = idOf(req);
  const note = text(isPlainObject(req.body) ? req.body.text : null, "anotação", 2000, true);
  await tx(async (d) => {
    if (!(await d.prepare("SELECT 1 FROM opportunities WHERE id=?").get(id))) throw new Invalid("Oportunidade não encontrada", 404);
    await logEvent(d, id, note);
    await d.prepare("UPDATE opportunities SET updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
  });
  res.status(201).json({ ok: true });
}));

opportunitiesRouter.post("/:id/convert", wrap(async (req, res) => {
  const id = idOf(req);
  const b = isPlainObject(req.body) ? req.body : {};
  if (b.create_proposal !== undefined && typeof b.create_proposal !== "boolean") throw new Invalid("create_proposal deve ser verdadeiro ou falso");
  const out = await tx(async (d) => {
    const opp = await d.prepare("SELECT * FROM opportunities WHERE id=?").get(id);
    if (!opp) throw new Invalid("Oportunidade não encontrada", 404);
    const conversion = await convertToClient(d, opp);
    let proposalId = opp.proposal_id;
    if (b.create_proposal && !proposalId) {
      const service = text(b.service ?? opp.service, "serviço", 80, true);
      const value = money(b.value ?? opp.value, "valor", true);
      proposalId = Number((await d.prepare("INSERT INTO proposals (client_id, service, scope, value, status) VALUES (?,?,?,?, 'rascunho')")
        .run(conversion.client_id, service, opp.notes ? opp.notes.slice(0, 4000) : null, value)).lastInsertRowid);
      await d.prepare("UPDATE opportunities SET proposal_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(proposalId, id);
      await logEvent(d, id, `Proposta em rascunho #${proposalId} criada.`);
    }
    return { ...conversion, proposal_id: proposalId ?? null };
  });
  res.json({ ok: true, ...out });
}));

opportunitiesRouter.delete("/:id", wrap(async (req, res) => {
  const id = idOf(req);
  await tx(async (d) => {
    const opp = await d.prepare("SELECT proposal_id FROM opportunities WHERE id=?").get(id);
    if (!opp) throw new Invalid("Oportunidade não encontrada", 404);
    if (opp.proposal_id) throw new Invalid("Esta oportunidade tem uma proposta vinculada. Marque como perdida em vez de excluir.", 409);
    await d.prepare("DELETE FROM opportunity_events WHERE opportunity_id=?").run(id);
    await d.prepare("DELETE FROM opportunities WHERE id=?").run(id);
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------------------------------------
// Rotas PÚBLICAS (sem login): marca da empresa e captura de leads. Só gravam um lead; não leem nada privado.
// ---------------------------------------------------------------------------------------------------------
export const leadRouter = Router();

/** Origens (https://dominio, sem barra final) separadas por vírgula: sites que podem hospedar o formulário de captura. */
export const originList = (v) => {
  const s = text(v, "origens permitidas", 800);
  if (s === null) return null;
  const list = s.split(",").map((x) => x.trim()).filter(Boolean);
  if (list.length > 10) throw new Invalid("origens permitidas: no máximo 10");
  for (const o of list)
    if (!/^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{2,5})?$/i.test(o))
      throw new Invalid(`origem inválida: ${o} (use https://seusite.com.br, sem barra no final)`);
  return list.join(",");
};
const expectedOrigin = (req) => process.env.APP_ORIGIN || `${process.env.NODE_ENV === "production" ? "https" : req.protocol}://${req.get("host")}`;
async function allowedOrigins() {
  const fromDb = (await db.prepare("SELECT value FROM settings WHERE key='lead_allowed_origins'").get())?.value ?? "";
  return [...fromDb.split(","), ...(process.env.LEAD_ALLOWED_ORIGINS ?? "").split(",")].map((s) => s.trim()).filter(Boolean);
}
/** Mesma origem sempre vale; outras só se estiverem na lista configurada (sites que hospedam o formulário). */
async function applyCors(req, res) {
  const origin = req.get("origin");
  if (!origin || origin === expectedOrigin(req) || (!process.env.APP_ORIGIN && process.env.NODE_ENV !== "production" && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))) return true;
  if (!(await allowedOrigins()).includes(origin)) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  return true;
}

leadRouter.options("/lead", wrap(async (req, res) => {
  if (!(await applyCors(req, res))) return fail(res, 403, "Origem não autorizada");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");
  res.status(204).end();
}));

leadRouter.get("/brand", wrap(async (_req, res) => {
  const row = await db.prepare("SELECT value FROM settings WHERE key='company_name'").get();
  res.json({ company_name: row?.value || null });
}));

/** Limite por IP (10/hora) e global (120/hora). Conta também tentativas inválidas e de robôs. */
async function leadAllowed(ip) {
  const now = Date.now();
  const expires = now + 3_600_000;
  await db.prepare("DELETE FROM auth_attempts WHERE expires <= ?").run(now);
  const hit = async (key) => Number((await db.prepare(
    "INSERT INTO auth_attempts (key, count, expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count",
  ).get(key, expires)).count);
  const mine = await hit(`lead:ip:${ip}`);
  const all = await hit("lead:all");
  return mine <= 10 && all <= 120;
}

leadRouter.post("/lead", wrap(async (req, res) => {
  if (!req.is("application/json")) return fail(res, 415, "Envie JSON");
  if (!(await applyCors(req, res))) return fail(res, 403, "Origem não autorizada");
  if (!(await leadAllowed(req.ip))) { res.setHeader("Retry-After", "3600"); return fail(res, 429, "Muitos envios. Tente novamente mais tarde."); }
  const b = req.body;
  if (!isPlainObject(b)) throw new Invalid("Corpo JSON inválido");
  // Campo-isca escondido: pessoas não o veem nem preenchem. Se vier preenchido, finge sucesso e não grava nada.
  if (b.website !== undefined && b.website !== "") return res.status(201).json({ ok: true });

  const name = nameText(b.name);
  const mail = email(b.email);
  const phone = phoneText(b.phone);
  if (!mail && !phone) throw new Invalid("Informe um e-mail ou um telefone para retornarmos");
  const company = text(b.company, "empresa", 120);
  const service = text(b.service, "serviço", 80);
  const message = text(b.message, "mensagem", 2000);

  await tx(async (d) => {
    // Mesmo contato com oportunidade aberta nos últimos 30 dias: registra no histórico em vez de criar outra.
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    let dup = null;
    if (mail) dup = await d.prepare(`SELECT id FROM opportunities WHERE lower(email)=lower(?) AND stage IN (${OPEN_STAGES.map(() => "?").join(",")}) AND created_at >= ? ORDER BY id DESC LIMIT 1`).get(mail, ...OPEN_STAGES, since);
    if (!dup && phone) {
      const n = digits(phone);
      const rows = await d.prepare(`SELECT id, phone FROM opportunities WHERE phone IS NOT NULL AND stage IN (${OPEN_STAGES.map(() => "?").join(",")}) AND created_at >= ? ORDER BY id DESC LIMIT 500`).all(...OPEN_STAGES, since);
      dup = rows.find((r) => digits(r.phone) === n) ?? null;
    }
    if (dup) {
      await logEvent(d, dup.id, `Novo contato pelo formulário${service ? ` (${service})` : ""}: ${message ?? "(sem mensagem)"}`);
      await d.prepare("UPDATE opportunities SET updated_at=CURRENT_TIMESTAMP WHERE id=?").run(dup.id);
      return;
    }
    const known = mail ? await d.prepare("SELECT id FROM clients WHERE lower(email)=lower(?) ORDER BY id LIMIT 1").get(mail) : null;
    const id = Number((await d.prepare(
      "INSERT INTO opportunities (name, company, email, phone, source, service, notes, client_id) VALUES (?,?,?,?, 'Formulário do site', ?,?,?)",
    ).run(name, company, mail, phone, service, message, known?.id ?? null)).lastInsertRowid);
    await logEvent(d, id, `Lead recebido pelo formulário do site${known ? ` (cliente existente #${known.id})` : ""}.`);
  });
  res.status(201).json({ ok: true });
}));
