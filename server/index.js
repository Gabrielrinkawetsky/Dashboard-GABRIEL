import express from "express";
import { existsSync } from "node:fs";
import { db, dbState, tx } from "./db.js";
import { addMonths, today } from "./dates.js";
import { authenticate, changePassword, cookie, createSession, getSession, loginAllowed, revokeSession, safeEqual } from "./auth.js";
import { removeDemo, seedDemo } from "./demo.js";
import { leadRouter, opportunitiesRouter, originList } from "./funnel.js";
import { Invalid, bool01, checklist, date, email, int, isDate, isPlainObject, money, oneOf, text } from "./validate.js";

const app = express();
app.disable("x-powered-by");
// Atrás de proxy reverso (Vercel, Nginx, Cloudflare...) defina TRUST_PROXY (ex.: 1) para o limite de tentativas usar o IP real do cliente.
if (process.env.TRUST_PROXY) app.set("trust proxy", /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  // Google Fonts (index.html) precisa de style-src/font-src; sem isso a fonte é bloqueada em produção.
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; connect-src 'self'; font-src 'self' https://fonts.gstatic.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  if (process.env.NODE_ENV === "production") res.setHeader("Strict-Transport-Security", "max-age=31536000");
  if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
  if (req.path.startsWith("/api") && !["GET", "HEAD", "OPTIONS"].includes(req.method) && req.path !== "/api/webhooks/payments" && req.path !== "/api/public/lead") {
    if (!req.is("application/json")) return res.status(415).json({ error: "Envie JSON" });
    if (req.get("sec-fetch-site") === "cross-site") return res.status(403).json({ error: "Origem não autorizada" });
    const origin = req.get("origin");
    const expected = process.env.APP_ORIGIN || (process.env.NODE_ENV === "production" ? "https" : req.protocol) + "://" + req.get("host");
    const allowed = !process.env.APP_ORIGIN && process.env.NODE_ENV !== "production"
      ? [expected, "http://localhost:5180", "http://127.0.0.1:5180"] : [expected];
    if (origin && !allowed.includes(origin)) return res.status(403).json({ error: "Origem não autorizada" });
  }
  next();
});
app.use("/api/webhooks", express.json({ limit: "64kb" })); // webhook: corpo pequeno
app.use(express.json({ limit: "1mb" }));

// Estado do banco, sem segredos: só "sim/não". Útil para ver na hora por que o login não funciona.
app.get("/api/health", async (_req, res) => {
  if (dbState.problem) return res.status(503).json({ ok: false, database: false, reason: dbState.problem });
  try {
    const row = await db.prepare("SELECT count(*) AS n FROM auth_users").get();
    res.json({ ok: true, database: true, adminCreated: Number(row.n) > 0, webhookEnabled: Boolean(process.env.WEBHOOK_SECRET) });
  } catch (e) {
    console.error("[health] falha ao consultar o banco:", e.message);
    res.status(503).json({ ok: false, database: false, reason: "O banco de dados não respondeu." });
  }
});
// Sem banco pronto o servidor não cai: responde 503 com a causa (a tela de login mostra esta mensagem).
app.use("/api", (req, res, next) => {
  if (!dbState.problem || req.path === "/session") return next();
  res.status(503).json({ error: dbState.problem });
});
const PORT = Number(process.env.PORT ?? 3001);
const STAGES = ["Briefing", "Aguardando materiais", "Design", "Desenvolvimento", "Revisão", "Entregue"];
const fail = (res, code, error) => res.status(code).json({ error });
const bad = (msg, code = 422) => Object.assign(new Error(msg), { code });
/** Id de rota: só dígitos; qualquer outra coisa é "não encontrado" (nunca chega ao banco). */
const idParam = (req) => (/^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null);

// Saldo líquido (pagamentos − estornos) já recebido de uma parcela. "d" é o banco ou a transação em andamento.
const net = async (d, installmentId) =>
  (await d.prepare("SELECT COALESCE(SUM(CASE WHEN type='refund' THEN -amount ELSE amount END),0) AS n FROM payments WHERE installment_id=?").get(installmentId)).n;

// ---------- Webhook (autenticado por segredo próprio, fora da sessão) ----------
// Limite de falhas de segredo por IP (em memória, por instância): barra tentativa de adivinhar o segredo.
const hookFails = new Map();
const hookBlocked = (ip) => { const e = hookFails.get(ip); return Boolean(e && e.reset > Date.now() && e.count >= 30); };
const hookFail = (ip) => {
  const now = Date.now();
  if (hookFails.size > 5000) for (const [k, v] of hookFails) if (v.reset <= now) hookFails.delete(k);
  const e = hookFails.get(ip);
  if (!e || e.reset <= now) hookFails.set(ip, { count: 1, reset: now + 60_000 });
  else e.count++;
};
const ID_RE = /^[A-Za-z0-9_.-]{1,100}$/; // sem ":" (separador do id de estorno)
const PROVIDER_RE = /^[a-z0-9_-]{1,40}$/;

app.post("/api/webhooks/payments", async (req, res) => {
  if (!process.env.WEBHOOK_SECRET) return fail(res, 503, "Webhook desligado: defina WEBHOOK_SECRET para ativá-lo.");
  if (hookBlocked(req.ip)) { res.setHeader("Retry-After", "60"); return fail(res, 429, "Muitas tentativas"); }
  const secret = req.get("x-webhook-secret");
  if (!secret || !safeEqual(secret, process.env.WEBHOOK_SECRET)) { hookFail(req.ip); return fail(res, 401, "Segredo inválido"); }
  const b = req.body;
  if (!isPlainObject(b)) return fail(res, 400, "Corpo JSON inválido");
  // Formato validado ANTES de gravar qualquer coisa: um evento malformado nunca "envenena" a idempotência.
  const provider = b.provider === undefined ? "generico" : b.provider;
  if (typeof provider !== "string" || !PROVIDER_RE.test(provider)) return fail(res, 400, "provider inválido");
  for (const k of ["event_id", "payment_id"]) if (typeof b[k] !== "string" || !ID_RE.test(b[k])) return fail(res, 400, `${k} inválido`);
  if (!["payment.confirmed", "payment.refunded", "payment.canceled"].includes(b.type)) return fail(res, 422, "Tipo de evento não suportado");
  try {
    const paidRaw = typeof b.paid_at === "string" ? b.paid_at.slice(0, 10) : b.paid_at;
    const paidAt = b.paid_at === undefined ? today() : paidRaw;
    if (!isDate(paidAt)) throw bad("paid_at inválido");
    if (b.currency !== undefined && b.currency !== "BRL") throw bad("Moeda inválida: apenas BRL");
    if (b.amount !== undefined && !(Number.isSafeInteger(b.amount) && b.amount > 0)) throw bad("amount deve ser um inteiro positivo em centavos");
    const out = await tx(async (d) => {
      const seen = await d.prepare("INSERT OR IGNORE INTO webhook_events (provider, event_id, payload) VALUES (?,?,?)").run(provider, b.event_id, JSON.stringify(b));
      if (!seen.changes) return { duplicate: true };
      if (b.type === "payment.confirmed") {
        if (b.currency !== "BRL") throw bad("Moeda obrigatória: BRL");
        if (b.amount === undefined) throw bad("amount obrigatório");
        const inst = Number.isSafeInteger(b.installment_id) ? await d.prepare("SELECT * FROM installments WHERE id=?").get(b.installment_id) : null;
        if (!inst) throw bad("Parcela inexistente");
        if (b.client_id !== undefined && b.client_id !== inst.client_id) throw bad("Cliente do evento não corresponde à parcela");
        if (b.amount > inst.amount - await net(d, inst.id)) throw bad("Valor excede o saldo da parcela");
        const r = await d.prepare("INSERT OR IGNORE INTO payments (installment_id, client_id, project_id, amount, type, paid_at, source, external_id, note) VALUES (?,?,?,?, 'payment', ?,?,?,?)")
          .run(inst.id, inst.client_id, inst.project_id, b.amount, paidAt, provider, b.payment_id, "Confirmado via integração");
        return { duplicate: !r.changes };
      }
      // estorno / cancelamento
      const orig = await d.prepare("SELECT * FROM payments WHERE source=? AND external_id=? AND type='payment'").get(provider, b.payment_id);
      if (!orig) throw bad("Pagamento original não encontrado");
      // Prefixo exato (instr), nunca LIKE: "_" e "%" em ids do provedor seriam curingas e misturariam pagamentos.
      const refunded = (await d.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE source=? AND type='refund' AND instr(external_id, ?) = 1").get(provider, `${orig.external_id}:`)).s;
      const amount = b.amount ?? orig.amount - refunded;
      if (!(amount > 0) || amount > orig.amount - refunded) throw bad("Valor de estorno inválido");
      await d.prepare("INSERT INTO payments (installment_id, client_id, project_id, amount, type, paid_at, source, external_id, note) VALUES (?,?,?,?, 'refund', ?,?,?,?)")
        .run(orig.installment_id, orig.client_id, orig.project_id, amount, paidAt, provider, `${orig.external_id}:${b.event_id}`, b.type === "payment.canceled" ? "Cancelamento via integração" : "Estorno via integração");
      return { duplicate: false };
    });
    res.json({ ok: true, ...out });
  } catch (e) {
    if (e.code === 422) return fail(res, 422, e.message);
    console.error("[webhook] erro ao processar evento:", e.message);
    fail(res, 500, "Erro ao processar evento");
  }
});

// ---------- Autenticação ----------
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || username.length > 80 || typeof password !== "string" || password.length > 128) return fail(res, 400, "Dados de acesso inválidos");
  const name = username.trim().toLowerCase();
  if (!await loginAllowed(req.ip, name)) { res.setHeader("Retry-After", "900"); return fail(res, 429, "Muitas tentativas. Aguarde 15 minutos."); }
  const user = await authenticate(name, password);
  if (!user) return fail(res, 401, "Usuário ou senha incorretos");
  await revokeSession(req);
  res.setHeader("Set-Cookie", cookie(await createSession(user.id)));
  res.json({ ok: true });
});
app.post("/api/logout", async (req, res) => {
  await revokeSession(req);
  res.setHeader("Set-Cookie", cookie());
  res.json({ ok: true });
});
app.get("/api/session", async (req, res) => {
  const user = await getSession(req);
  res.json({ authenticated: Boolean(user), username: user?.username });
});
// Rotas públicas (sem login): marca da empresa e captura de leads. Têm validação, limite de envios e política de origem próprias.
app.use("/api/public", leadRouter);
app.use("/api", async (req, res, next) => {
  const user = await getSession(req);
  if (!user) return fail(res, 401, "Não autenticado");
  req.authUser = user;
  next();
});
app.use("/api/opportunities", opportunitiesRouter); // funil de vendas (exige sessão: está depois do guarda acima)
app.post("/api/change-password", async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== "string" || currentPassword.length > 128 || typeof newPassword !== "string" || newPassword.length < 15 || newPassword.length > 128) return fail(res, 400, "A nova senha deve ter entre 15 e 128 caracteres");
  if (!await loginAllowed(req.ip, req.authUser.username)) return fail(res, 429, "Muitas tentativas. Aguarde 15 minutos.");
  if (!await authenticate(req.authUser.username, currentPassword)) return fail(res, 401, "Senha atual incorreta");
  if (newPassword === currentPassword) return fail(res, 400, "Escolha uma senha diferente da atual");
  await changePassword(req.authUser.id, newPassword);
  res.setHeader("Set-Cookie", cookie(await createSession(req.authUser.id)));
  res.json({ ok: true });
});

// ---------- Dados ----------
// Campos permitidos por tabela, com validação estrita (tipo, tamanho, intervalo, data real, enum). O resto é ignorado.
const PROPOSAL_STATUS = ["rascunho", "enviada", "aprovada", "recusada", "expirada"];
const SPEC = {
  clients: {
    name: (v) => text(v, "nome", 120, true), company: (v) => text(v, "empresa", 120), email: (v) => email(v),
    phone: (v) => text(v, "telefone", 40), notes: (v) => text(v, "observações", 4000),
  },
  services: { name: (v) => text(v, "nome", 80, true), default_price: (v) => int(v, "preço padrão", { min: 0, max: 100_000_000_000 }) ?? 0, active: (v) => bool01(v, "ativo") },
  proposals: {
    client_id: (v) => int(v, "cliente", { min: 1 }), service: (v) => text(v, "serviço", 80, true), scope: (v) => text(v, "escopo", 4000),
    value: (v) => money(v, "valor"), deadline: (v) => date(v, "prazo"), valid_until: (v) => date(v, "validade"), status: (v) => oneOf(v, "status", PROPOSAL_STATUS),
  },
  projects: {
    client_id: (v) => int(v, "cliente", { min: 1 }), name: (v) => text(v, "nome", 160), service: (v) => text(v, "serviço", 80, true),
    scope: (v) => text(v, "escopo", 4000), stage: (v) => oneOf(v, "etapa", STAGES), deadline: (v) => date(v, "prazo"),
    owner: (v) => text(v, "responsável", 120), progress: (v) => int(v, "progresso", { min: 0, max: 100 }) ?? 0,
    checklist: (v) => JSON.stringify(checklist(v)), notes: (v) => text(v, "observações", 4000), links: (v) => text(v, "links", 4000), cancelled: (v) => bool01(v, "cancelado"),
  },
  expenses: { project_id: (v) => int(v, "projeto", { min: 1 }), description: (v) => text(v, "descrição", 200, true), amount: (v) => money(v, "valor"), date: (v) => date(v, "data") },
  recurring: {
    client_id: (v) => int(v, "cliente", { min: 1 }), name: (v) => text(v, "nome", 120, true), kind: (v) => text(v, "tipo", 40), amount: (v) => money(v, "valor"),
    period: (v) => oneOf(v, "periodicidade", ["mensal", "trimestral", "anual"]), status: (v) => oneOf(v, "situação", ["ativo", "pausado", "cancelado"]), next_due: (v) => date(v, "próxima cobrança"),
  },
};
const REQUIRED = {
  clients: ["name"], services: ["name"], proposals: ["client_id", "service", "value"], projects: ["client_id", "service"],
  expenses: ["description", "amount", "date"], recurring: ["client_id", "name", "amount"],
};
const NOT_NULL = { proposals: ["status"], projects: ["stage"], recurring: ["period", "status"] };
// Quem aponta para cada tabela. Checado no código para valer em qualquer banco (as chaves estrangeiras são só a segunda barreira).
const CHILDREN = {
  clients: ["proposals.client_id", "projects.client_id", "installments.client_id", "recurring.client_id", "payments.client_id"],
  proposals: ["projects.proposal_id", "installments.proposal_id"],
  projects: ["installments.project_id", "expenses.project_id", "payments.project_id"],
};
const exists = async (table, id) => Boolean(await db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(id));

const clean = async (t, body, partial) => {
  if (!isPlainObject(body)) throw new Invalid("Corpo JSON inválido");
  const out = {};
  for (const [col, parse] of Object.entries(SPEC[t])) {
    if (!Object.hasOwn(body, col)) continue;
    out[col] = parse(body[col]);
    if (out[col] === null && REQUIRED[t].includes(col)) throw new Invalid(`Campo obrigatório: ${col}`);
  }
  // Colunas NOT NULL com valor padrão: vazio = "não informado" (mantém o valor atual / o padrão), nunca NULL.
  for (const c of NOT_NULL[t] ?? []) if (out[c] === null) delete out[c];
  if (!partial) for (const r of REQUIRED[t]) if (!(r in out)) throw new Invalid(`Campo obrigatório: ${r}`);
  if (out.client_id != null && !await exists("clients", out.client_id)) throw new Invalid("Cliente inexistente");
  if (out.project_id != null && !await exists("projects", out.project_id)) throw new Invalid("Projeto inexistente");
  return out;
};

app.get("/api/data", async (_req, res) => {
  const all = (t, order = "id DESC") => db.prepare(`SELECT * FROM ${t} ORDER BY ${order}`).all();
  const [clients, services, proposals, projects, history, installments, payments, expenses, recurring, settingRows] = await Promise.all([
    all("clients"), all("services", "id"), all("proposals"), all("projects"), all("project_history"), all("installments", "due_date"),
    all("payments", "paid_at DESC, id DESC"), all("expenses"), all("recurring"), db.prepare("SELECT key, value FROM settings").all(),
  ]);
  res.json({
    clients, services, proposals, projects: projects.map((p) => ({ ...p, checklist: JSON.parse(p.checklist || "[]") })),
    history, installments, payments, expenses, recurring, settings: Object.fromEntries(settingRows.map((r) => [r.key, r.value])),
    integration: { webhookConfigured: Boolean(process.env.WEBHOOK_SECRET), providerConnected: false },
  });
});

app.get("/api/webhook-secret", (_req, res) => res.json({ secret: process.env.WEBHOOK_SECRET }));

app.put("/api/settings", async (req, res) => {
  try {
    if (!isPlainObject(req.body)) throw new Invalid("Corpo JSON inválido");
    const rules = { company_name: (v) => text(v, "empresa", 120), owner_name: (v) => text(v, "responsável", 120), email: (v) => email(v), phone: (v) => text(v, "telefone", 40), lead_allowed_origins: (v) => originList(v) };
    const values = Object.entries(rules).filter(([k]) => Object.hasOwn(req.body, k)).map(([k, parse]) => [k, parse(req.body[k]) ?? ""]);
    await tx(async (d) => {
      for (const [k, v] of values) await d.prepare("INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k, v);
    });
    res.json({ ok: true });
  } catch (e) { fail(res, e.code ?? 500, e.code ? e.message : "Erro ao salvar"); }
});

app.post("/api/demo", async (_req, res) => res.json({ seeded: await seedDemo() }));
app.delete("/api/demo", async (_req, res) => { await removeDemo(); res.json({ ok: true }); });

// Aprovar proposta: cria projeto e parcelas uma única vez
app.post("/api/proposals/:id/approve", async (req, res) => {
  const id = idParam(req);
  const p = id === null ? undefined : await db.prepare("SELECT * FROM proposals WHERE id=?").get(id);
  if (!p) return fail(res, 404, "Proposta não encontrada");
  if (p.status === "aprovada" || await db.prepare("SELECT 1 FROM projects WHERE proposal_id=?").get(p.id)) return fail(res, 409, "Proposta já aprovada");
  let entrada, parcelas, first;
  try {
    const b = isPlainObject(req.body) ? req.body : {};
    entrada = int(b.entrada ?? 0, "entrada", { min: 0, max: 100_000_000_000 }) ?? 0;
    parcelas = int(b.parcelas ?? 1, "parcelas", { min: 1, max: 24 }) ?? 1;
    first = date(b.primeiro_vencimento, "primeiro vencimento") ?? today();
  } catch (e) { return fail(res, 400, e.message); }
  if (entrada >= p.value) return fail(res, 400, "Entrada deve ser menor que o valor total");
  try {
    const projectId = await tx(async (d) => {
      // Reconfere DENTRO da transação (uma por vez): duas aprovações simultâneas nunca criam dois projetos.
      const current = await d.prepare("SELECT status FROM proposals WHERE id=?").get(p.id);
      if (current?.status === "aprovada" || await d.prepare("SELECT 1 FROM projects WHERE proposal_id=?").get(p.id)) throw bad("Proposta já aprovada", 409);
      await d.prepare("UPDATE proposals SET status='aprovada', decided_at=? WHERE id=?").run(today(), p.id);
      const owner = (await d.prepare("SELECT value FROM settings WHERE key='owner_name'").get())?.value || "Gabriel Ribeiro Silva";
      const cl = await d.prepare("SELECT name, company FROM clients WHERE id=?").get(p.client_id);
      const pid = Number((await d.prepare("INSERT INTO projects (proposal_id, client_id, name, service, scope, deadline, owner, checklist) VALUES (?,?,?,?,?,?,?,?)")
        .run(p.id, p.client_id, `${p.service} · ${cl.company || cl.name}`, p.service, p.scope, p.deadline, owner,
          JSON.stringify([{ text: "Briefing recebido", done: false }, { text: "Materiais do cliente", done: false }, { text: "Layout aprovado", done: false }, { text: "Publicação", done: false }]))).lastInsertRowid);
      await d.prepare("INSERT INTO project_history (project_id, text) VALUES (?,?)").run(pid, "Projeto criado a partir da proposta aprovada");
      const ins = d.prepare("INSERT INTO installments (proposal_id, project_id, client_id, label, amount, due_date) VALUES (?,?,?,?,?,?)");
      const rest = p.value - entrada, base = Math.floor(rest / parcelas);
      if (entrada > 0) await ins.run(p.id, pid, p.client_id, "Entrada", entrada, today());
      for (let i = 0; i < parcelas; i++) {
        const label = entrada > 0 || parcelas > 1 ? `Parcela ${i + 1}/${parcelas}` : "Pagamento único";
        await ins.run(p.id, pid, p.client_id, label, i === parcelas - 1 ? rest - base * (parcelas - 1) : base, addMonths(first, i));
      }
      return pid;
    });
    res.json({ ok: true, project_id: projectId });
  } catch (e) {
    if (e.code === 409) return fail(res, 409, e.message);
    const dup = String(e.message).includes("UNIQUE");
    if (!dup) console.error("[aprovar] erro:", e.message);
    fail(res, dup ? 409 : 500, dup ? "Proposta já aprovada" : "Erro ao aprovar");
  }
});

// Pagamento manual (total ou parcial). Checar o saldo e gravar acontecem na MESMA transação (uma por vez).
app.post("/api/payments", async (req, res) => {
  try {
    const b = isPlainObject(req.body) ? req.body : {};
    const installmentId = int(b.installment_id, "parcela", { min: 1, required: true });
    const amount = money(b.amount, "valor", true);
    const paidAt = date(b.paid_at, "data do pagamento") ?? today();
    const note = text(b.note, "observação", 500);
    await tx(async (d) => {
      const inst = await d.prepare("SELECT * FROM installments WHERE id=?").get(installmentId);
      if (!inst) throw new Invalid("Parcela inexistente");
      if (amount > inst.amount - await net(d, inst.id)) throw new Invalid("Valor maior que o saldo da parcela");
      await d.prepare("INSERT INTO payments (installment_id, client_id, project_id, amount, type, paid_at, source, note) VALUES (?,?,?,?, 'payment', ?, 'manual', ?)")
        .run(inst.id, inst.client_id, inst.project_id, amount, paidAt, note);
    });
    res.json({ ok: true });
  } catch (e) { fail(res, e.code ?? 500, e.code ? e.message : "Erro ao salvar"); }
});
app.delete("/api/payments/:id", async (req, res) => {
  const id = idParam(req);
  const r = id === null ? { changes: 0 } : await db.prepare("DELETE FROM payments WHERE id=? AND source='manual'").run(id);
  r.changes ? res.json({ ok: true }) : fail(res, 400, "Só é possível excluir lançamentos manuais");
});

// Cobrança avulsa (parcela sem proposta)
app.post("/api/installments", async (req, res) => {
  try {
    const b = isPlainObject(req.body) ? req.body : {};
    const clientId = int(b.client_id, "cliente", { min: 1, required: true });
    const projectId = int(b.project_id, "projeto", { min: 1 });
    const amount = money(b.amount, "valor", true);
    const dueDate = date(b.due_date, "vencimento", true);
    const label = text(b.label, "descrição", 120) ?? "Cobrança avulsa";
    if (!await exists("clients", clientId)) throw new Invalid("Cliente inexistente");
    if (projectId !== null && !await db.prepare("SELECT 1 FROM projects WHERE id=? AND client_id=?").get(projectId, clientId)) throw new Invalid("Projeto inexistente para este cliente");
    await db.prepare("INSERT INTO installments (client_id, project_id, proposal_id, label, amount, due_date) VALUES (?,?,?,?,?,?)").run(clientId, projectId, null, label, amount, dueDate);
    res.json({ ok: true });
  } catch (e) { fail(res, e.code ?? 500, e.code ? e.message : "Erro ao salvar"); }
});

app.post("/api/projects/:id/notes", async (req, res) => {
  try {
    const id = idParam(req);
    if (id === null || !await exists("projects", id)) return fail(res, 404, "Projeto não encontrado");
    const body = isPlainObject(req.body) ? req.body : {};
    const noteText = text(body.text, "anotação", 2000, true);
    await db.prepare("INSERT INTO project_history (project_id, text) VALUES (?,?)").run(id, noteText);
    res.json({ ok: true });
  } catch (e) { fail(res, e.code ?? 500, e.code ? e.message : "Erro ao salvar"); }
});

// CRUD genérico
for (const t of Object.keys(SPEC)) {
  app.post(`/api/${t}`, async (req, res) => {
    try {
      const d = await clean(t, req.body, false);
      if (t === "proposals" && d.status === "aprovada") d.status = "enviada"; // aprovação só pelo fluxo próprio
      const keys = Object.keys(d);
      const id = Number((await db.prepare(`INSERT INTO ${t} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map((k) => d[k]))).lastInsertRowid);
      if (t === "projects") await db.prepare("INSERT INTO project_history (project_id, text) VALUES (?,?)").run(id, "Projeto criado");
      res.json({ id });
    } catch (e) {
      if (!e.code) console.error(`[${t}] erro ao salvar:`, e.message);
      fail(res, e.code ?? 500, e.code ? e.message : "Erro ao salvar");
    }
  });
  app.patch(`/api/${t}/:id`, async (req, res) => {
    try {
      const id = idParam(req);
      const before = id === null ? undefined : await db.prepare(`SELECT * FROM ${t} WHERE id=?`).get(id);
      if (!before) return fail(res, 404, "Registro não encontrado");
      const d = await clean(t, req.body, true);
      if (t === "proposals" && d.status === "aprovada" && before.status !== "aprovada") return fail(res, 400, "Use o botão Aprovar para criar o projeto e as parcelas");
      if (t === "proposals" && before.status === "aprovada") {
        delete d.status;
        // Depois de aprovada, valor/cliente/serviço já geraram projeto e parcelas: mudar aqui deixaria o financeiro inconsistente.
        for (const k of ["value", "client_id", "service"]) if (k in d && d[k] !== before[k]) throw new Invalid("Proposta aprovada: valor, cliente e serviço não podem ser alterados", 409);
      }
      if (t === "projects" && "client_id" in d && d.client_id !== before.client_id
        && (before.proposal_id || await db.prepare("SELECT 1 FROM installments WHERE project_id=?").get(id))) throw new Invalid("Projeto com proposta ou cobranças não pode trocar de cliente", 409);
      if (t === "proposals" && ["recusada", "expirada"].includes(d.status) && before.status !== d.status) d.decided_at = today();
      const keys = Object.keys(d);
      if (!keys.length) return res.json({ ok: true });
      await tx(async (q) => {
        await q.prepare(`UPDATE ${t} SET ${keys.map((k) => `${k}=?`).join(",")} WHERE id=?`).run(...keys.map((k) => d[k]), id);
        if (t === "projects") {
          const h = q.prepare("INSERT INTO project_history (project_id, text) VALUES (?,?)");
          if (d.stage && d.stage !== before.stage) await h.run(id, `Etapa: ${before.stage} → ${d.stage}`);
          if ("cancelled" in d && d.cancelled !== before.cancelled) await h.run(id, d.cancelled ? "Projeto cancelado" : "Projeto reaberto");
          if (d.deadline && d.deadline !== before.deadline) await h.run(id, "Prazo alterado");
          if (d.owner && d.owner !== before.owner) await h.run(id, `Responsável: ${d.owner}`);
        }
      });
      res.json({ ok: true });
    } catch (e) {
      if (!e.code) console.error(`[${t}] erro ao salvar:`, e.message);
      fail(res, e.code ?? 500, e.code ? e.message : "Erro ao salvar");
    }
  });
  app.delete(`/api/${t}/:id`, async (req, res) => {
    const id = idParam(req);
    if (id === null) return fail(res, 404, "Registro não encontrado");
    for (const ref of CHILDREN[t] ?? []) {
      const [table, col] = ref.split(".");
      if (await db.prepare(`SELECT 1 FROM ${table} WHERE ${col}=? LIMIT 1`).get(id)) return fail(res, 409, "Há registros vinculados; remova-os antes.");
    }
    try { await db.prepare(`DELETE FROM ${t} WHERE id=?`).run(id); res.json({ ok: true }); }
    catch { fail(res, 409, "Há registros vinculados; remova-os antes."); }
  });
}

// Rota /api inexistente e erros: sempre JSON genérico, sem stack nem caminhos internos.
app.use("/api", (_req, res) => fail(res, 404, "Não encontrado"));

// Fora da Vercel (npm start) o próprio servidor entrega o build; na Vercel quem entrega os arquivos é a CDN.
if (!process.env.VERCEL && existsSync("dist")) {
  app.use(express.static("dist"));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile("index.html", { root: "dist" }));
}

app.use((err, _req, res, _next) => {
  if (err?.type === "entity.parse.failed") return fail(res, 400, "JSON inválido");
  if (err?.type === "entity.too.large") return fail(res, 413, "Corpo grande demais");
  console.error("[erro]", err?.message ?? err);
  fail(res, 500, "Erro interno");
});

// Na Vercel o app é exportado como função (api/index.js); fora dela escuta em 127.0.0.1 por padrão.
// Atrás de proxy reverso mantenha 127.0.0.1. Use HOST=0.0.0.0 só se souber o que está expondo.
if (!process.env.VERCEL) {
  app.listen(PORT, process.env.HOST || "127.0.0.1", () => {
    console.log(`API em http://localhost:${PORT}`);
  });
}
export default app;
