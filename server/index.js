import express from "express";
import { existsSync } from "node:fs";
import { db, tx } from "./db.js";
import { generatedPassword, loginAllowed, makeToken, noteAttempt, readCookie, safeEqual, validToken } from "./auth.js";
import { removeDemo, seedDemo } from "./demo.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
const PORT = Number(process.env.PORT ?? 3001);
const STAGES = ["Briefing", "Aguardando materiais", "Design", "Desenvolvimento", "Revisão", "Entregue"];
const today = () => new Date().toISOString().slice(0, 10);
const fail = (res, code, error) => res.status(code).json({ error });
const bad = (msg, code = 422) => Object.assign(new Error(msg), { code });

// Saldo líquido (pagamentos − estornos) já recebido de uma parcela
const net = (installmentId) =>
  db.prepare("SELECT COALESCE(SUM(CASE WHEN type='refund' THEN -amount ELSE amount END),0) AS n FROM payments WHERE installment_id=?").get(installmentId).n;

// ---------- Webhook (autenticado por segredo próprio, fora da sessão) ----------
app.post("/api/webhooks/payments", (req, res) => {
  const secret = req.get("x-webhook-secret");
  if (!secret || !safeEqual(secret, process.env.WEBHOOK_SECRET)) return fail(res, 401, "Segredo inválido");
  const b = req.body ?? {};
  const provider = String(b.provider ?? "generico");
  if (!b.event_id || !b.type || !b.payment_id) return fail(res, 400, "event_id, type e payment_id são obrigatórios");
  try {
    const out = tx(() => {
      const seen = db.prepare("INSERT OR IGNORE INTO webhook_events (provider, event_id, payload) VALUES (?,?,?)").run(provider, String(b.event_id), JSON.stringify(b));
      if (!seen.changes) return { duplicate: true };
      const paidAt = String(b.paid_at ?? today()).slice(0, 10);
      if (b.type === "payment.confirmed") {
        const inst = db.prepare("SELECT * FROM installments WHERE id=?").get(Number(b.installment_id));
        const amount = Math.round(Number(b.amount));
        if (!inst || !(amount > 0)) throw bad("Parcela ou valor inválido");
        if (amount > inst.amount - net(inst.id)) throw bad("Valor excede o saldo da parcela");
        const r = db.prepare("INSERT OR IGNORE INTO payments (installment_id, client_id, project_id, amount, type, paid_at, source, external_id, note) VALUES (?,?,?,?, 'payment', ?,?,?,?)")
          .run(inst.id, inst.client_id, inst.project_id, amount, paidAt, provider, String(b.payment_id), "Confirmado via integração");
        return { duplicate: !r.changes };
      }
      if (b.type === "payment.refunded" || b.type === "payment.canceled") {
        const orig = db.prepare("SELECT * FROM payments WHERE source=? AND external_id=? AND type='payment'").get(provider, String(b.payment_id));
        if (!orig) throw bad("Pagamento original não encontrado");
        const refunded = db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE source=? AND external_id LIKE ? AND type='refund'").get(provider, `${orig.external_id}:%`).s;
        const amount = Math.round(Number(b.amount ?? orig.amount - refunded));
        if (!(amount > 0) || amount > orig.amount - refunded) throw bad("Valor de estorno inválido");
        db.prepare("INSERT INTO payments (installment_id, client_id, project_id, amount, type, paid_at, source, external_id, note) VALUES (?,?,?,?, 'refund', ?,?,?,?)")
          .run(orig.installment_id, orig.client_id, orig.project_id, amount, paidAt, provider, `${orig.external_id}:${b.event_id}`, b.type === "payment.canceled" ? "Cancelamento via integração" : "Estorno via integração");
        return { duplicate: false };
      }
      throw bad("Tipo de evento não suportado");
    });
    res.json({ ok: true, ...out });
  } catch (e) {
    fail(res, e.code === 422 ? 422 : 500, e.code === 422 ? e.message : "Erro ao processar evento");
  }
});

// ---------- Autenticação ----------
app.post("/api/login", (req, res) => {
  const ip = req.ip;
  if (!loginAllowed(ip)) return fail(res, 429, "Muitas tentativas. Aguarde um minuto.");
  if (!safeEqual(req.body?.password ?? "", process.env.ADMIN_PASSWORD)) { noteAttempt(ip); return fail(res, 401, "Senha incorreta"); }
  res.setHeader("Set-Cookie", `session=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${7 * 86400}`);
  res.json({ ok: true });
});
app.post("/api/logout", (_req, res) => {
  res.setHeader("Set-Cookie", "session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
  res.json({ ok: true });
});
app.get("/api/session", (req, res) => res.json({ authenticated: validToken(readCookie(req, "session")) }));

app.use("/api", (req, res, next) => (validToken(readCookie(req, "session")) ? next() : fail(res, 401, "Não autenticado")));

// ---------- Dados ----------
const TABLES = {
  clients: { cols: ["name", "company", "email", "phone", "notes"], req: ["name"] },
  services: { cols: ["name", "default_price", "active"], req: ["name"], ints: ["default_price", "active"] },
  proposals: { cols: ["client_id", "service", "scope", "value", "deadline", "valid_until", "status"], req: ["client_id", "service", "value"], ints: ["client_id", "value"] },
  projects: { cols: ["client_id", "name", "service", "scope", "stage", "deadline", "owner", "progress", "checklist", "notes", "links", "cancelled"], req: ["client_id", "service"], ints: ["client_id", "progress", "cancelled"] },
  expenses: { cols: ["project_id", "description", "amount", "date"], req: ["description", "amount", "date"], ints: ["project_id", "amount"] },
  recurring: { cols: ["client_id", "name", "kind", "amount", "period", "status", "next_due"], req: ["client_id", "name", "amount"], ints: ["client_id", "amount"] },
};
const PROPOSAL_STATUS = ["rascunho", "enviada", "aprovada", "recusada", "expirada"];

const clean = (t, body, partial) => {
  const cfg = TABLES[t], out = {};
  for (const c of cfg.cols) {
    if (!(c in body)) continue;
    let v = body[c];
    if (c === "checklist") v = JSON.stringify(Array.isArray(v) ? v : []);
    else if (cfg.ints?.includes(c)) v = v === "" || v == null ? null : Math.round(Number(v));
    else if (typeof v === "string") v = v.trim();
    out[c] = v === "" ? null : v;
  }
  if (!partial) for (const r of cfg.req) if (out[r] == null || Number.isNaN(out[r])) throw bad(`Campo obrigatório: ${r}`, 400);
  if (out.stage && !STAGES.includes(out.stage)) throw bad("Etapa inválida", 400);
  if (t === "proposals" && out.status && !PROPOSAL_STATUS.includes(out.status)) throw bad("Status inválido", 400);
  for (const k of ["value", "amount"]) if (k in out && !(out[k] > 0)) throw bad("Valor deve ser maior que zero", 400);
  return out;
};

app.get("/api/data", (_req, res) => {
  const all = (t, order = "id DESC") => db.prepare(`SELECT * FROM ${t} ORDER BY ${order}`).all();
  const settings = Object.fromEntries(db.prepare("SELECT key, value FROM settings").all().map((r) => [r.key, r.value]));
  res.json({
    clients: all("clients"), services: all("services", "id"), proposals: all("proposals"),
    projects: all("projects").map((p) => ({ ...p, checklist: JSON.parse(p.checklist || "[]") })),
    history: all("project_history"), installments: all("installments", "due_date"), payments: all("payments", "paid_at DESC, id DESC"),
    expenses: all("expenses"), recurring: all("recurring"), settings,
    integration: { webhookConfigured: Boolean(process.env.WEBHOOK_SECRET), providerConnected: false },
  });
});

app.get("/api/webhook-secret", (_req, res) => res.json({ secret: process.env.WEBHOOK_SECRET }));

app.put("/api/settings", (req, res) => {
  const ins = db.prepare("INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  tx(() => { for (const [k, v] of Object.entries(req.body ?? {})) if (["company_name", "owner_name", "email", "phone"].includes(k)) ins.run(k, String(v ?? "")); });
  res.json({ ok: true });
});

app.post("/api/demo", (_req, res) => res.json({ seeded: seedDemo() }));
app.delete("/api/demo", (_req, res) => { removeDemo(); res.json({ ok: true }); });

// Aprovar proposta: cria projeto e parcelas uma única vez
app.post("/api/proposals/:id/approve", (req, res) => {
  const p = db.prepare("SELECT * FROM proposals WHERE id=?").get(Number(req.params.id));
  if (!p) return fail(res, 404, "Proposta não encontrada");
  if (p.status === "aprovada" || db.prepare("SELECT 1 FROM projects WHERE proposal_id=?").get(p.id)) return fail(res, 409, "Proposta já aprovada");
  const entrada = Math.round(Number(req.body?.entrada ?? 0));
  const parcelas = Math.max(1, Math.min(24, Math.round(Number(req.body?.parcelas ?? 1))));
  if (!(entrada >= 0) || entrada >= p.value) return fail(res, 400, "Entrada deve ser menor que o valor total");
  const first = String(req.body?.primeiro_vencimento || today()).slice(0, 10);
  try {
    const projectId = tx(() => {
      db.prepare("UPDATE proposals SET status='aprovada', decided_at=? WHERE id=?").run(today(), p.id);
      const owner = db.prepare("SELECT value FROM settings WHERE key='owner_name'").get()?.value || "Gabriel Ribeiro Silva";
      const cl = db.prepare("SELECT name, company FROM clients WHERE id=?").get(p.client_id);
      const pid = Number(db.prepare("INSERT INTO projects (proposal_id, client_id, name, service, scope, deadline, owner, checklist) VALUES (?,?,?,?,?,?,?,?)")
        .run(p.id, p.client_id, `${p.service} · ${cl.company || cl.name}`, p.service, p.scope, p.deadline, owner,
          JSON.stringify([{ text: "Briefing recebido", done: false }, { text: "Materiais do cliente", done: false }, { text: "Layout aprovado", done: false }, { text: "Publicação", done: false }])).lastInsertRowid);
      db.prepare("INSERT INTO project_history (project_id, text) VALUES (?,?)").run(pid, "Projeto criado a partir da proposta aprovada");
      const ins = db.prepare("INSERT INTO installments (proposal_id, project_id, client_id, label, amount, due_date) VALUES (?,?,?,?,?,?)");
      const rest = p.value - entrada, base = Math.floor(rest / parcelas);
      if (entrada > 0) ins.run(p.id, pid, p.client_id, "Entrada", entrada, today());
      for (let i = 0; i < parcelas; i++) {
        const d = new Date(first + "T12:00:00");
        d.setMonth(d.getMonth() + i);
        const label = entrada > 0 || parcelas > 1 ? `Parcela ${i + 1}/${parcelas}` : "Pagamento único";
        ins.run(p.id, pid, p.client_id, label, i === parcelas - 1 ? rest - base * (parcelas - 1) : base, d.toISOString().slice(0, 10));
      }
      return pid;
    });
    res.json({ ok: true, project_id: projectId });
  } catch (e) {
    const dup = String(e.message).includes("UNIQUE");
    fail(res, dup ? 409 : 500, dup ? "Proposta já aprovada" : "Erro ao aprovar");
  }
});

// Pagamento manual (total ou parcial)
app.post("/api/payments", (req, res) => {
  const b = req.body ?? {};
  const amount = Math.round(Number(b.amount));
  const inst = db.prepare("SELECT * FROM installments WHERE id=?").get(Number(b.installment_id));
  if (!inst) return fail(res, 400, "Selecione a parcela");
  if (!(amount > 0)) return fail(res, 400, "Informe um valor maior que zero");
  if (amount > inst.amount - net(inst.id)) return fail(res, 400, "Valor maior que o saldo da parcela");
  db.prepare("INSERT INTO payments (installment_id, client_id, project_id, amount, type, paid_at, source, note) VALUES (?,?,?,?, 'payment', ?, 'manual', ?)")
    .run(inst.id, inst.client_id, inst.project_id, amount, String(b.paid_at || today()).slice(0, 10), b.note ? String(b.note) : null);
  res.json({ ok: true });
});
app.delete("/api/payments/:id", (req, res) => {
  const r = db.prepare("DELETE FROM payments WHERE id=? AND source='manual'").run(Number(req.params.id));
  r.changes ? res.json({ ok: true }) : fail(res, 400, "Só é possível excluir lançamentos manuais");
});

// Cobrança avulsa (parcela sem proposta)
app.post("/api/installments", (req, res) => {
  const b = req.body ?? {};
  const amount = Math.round(Number(b.amount));
  if (!b.client_id || !(amount > 0) || !b.due_date) return fail(res, 400, "Cliente, valor e vencimento são obrigatórios");
  db.prepare("INSERT INTO installments (client_id, project_id, proposal_id, label, amount, due_date) VALUES (?,?,?,?,?,?)")
    .run(Number(b.client_id), b.project_id ? Number(b.project_id) : null, null, b.label || "Cobrança avulsa", amount, String(b.due_date).slice(0, 10));
  res.json({ ok: true });
});

app.post("/api/projects/:id/notes", (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  if (!text) return fail(res, 400, "Escreva uma anotação");
  db.prepare("INSERT INTO project_history (project_id, text) VALUES (?,?)").run(Number(req.params.id), text);
  res.json({ ok: true });
});

// CRUD genérico
for (const t of Object.keys(TABLES)) {
  app.post(`/api/${t}`, (req, res) => {
    try {
      const d = clean(t, req.body ?? {}, false);
      if (t === "proposals" && d.status === "aprovada") d.status = "enviada"; // aprovação só pelo fluxo próprio
      const keys = Object.keys(d);
      const id = Number(db.prepare(`INSERT INTO ${t} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map((k) => d[k])).lastInsertRowid);
      if (t === "projects") db.prepare("INSERT INTO project_history (project_id, text) VALUES (?,?)").run(id, "Projeto criado");
      res.json({ id });
    } catch (e) { fail(res, e.code ?? 500, e.code ? e.message : "Erro ao salvar"); }
  });
  app.patch(`/api/${t}/:id`, (req, res) => {
    try {
      const id = Number(req.params.id);
      const before = db.prepare(`SELECT * FROM ${t} WHERE id=?`).get(id);
      if (!before) return fail(res, 404, "Registro não encontrado");
      const d = clean(t, req.body ?? {}, true);
      if (t === "proposals" && d.status === "aprovada" && before.status !== "aprovada") return fail(res, 400, "Use o botão Aprovar para criar o projeto e as parcelas");
      if (t === "proposals" && before.status === "aprovada") delete d.status;
      if (t === "proposals" && ["recusada", "expirada"].includes(d.status) && before.status !== d.status) d.decided_at = today();
      const keys = Object.keys(d);
      if (!keys.length) return res.json({ ok: true });
      tx(() => {
        db.prepare(`UPDATE ${t} SET ${keys.map((k) => `${k}=?`).join(",")} WHERE id=?`).run(...keys.map((k) => d[k]), id);
        if (t === "projects") {
          const h = db.prepare("INSERT INTO project_history (project_id, text) VALUES (?,?)");
          if (d.stage && d.stage !== before.stage) h.run(id, `Etapa: ${before.stage} → ${d.stage}`);
          if ("cancelled" in d && d.cancelled !== before.cancelled) h.run(id, d.cancelled ? "Projeto cancelado" : "Projeto reaberto");
          if (d.deadline && d.deadline !== before.deadline) h.run(id, "Prazo alterado");
          if (d.owner && d.owner !== before.owner) h.run(id, `Responsável: ${d.owner}`);
        }
      });
      res.json({ ok: true });
    } catch (e) { fail(res, e.code ?? 500, e.code ? e.message : "Erro ao salvar"); }
  });
  app.delete(`/api/${t}/:id`, (req, res) => {
    try { db.prepare(`DELETE FROM ${t} WHERE id=?`).run(Number(req.params.id)); res.json({ ok: true }); }
    catch { fail(res, 409, "Há registros vinculados; remova-os antes."); }
  });
}

if (existsSync("dist")) {
  app.use(express.static("dist"));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile("index.html", { root: "dist" }));
}

app.listen(PORT, () => {
  console.log(`API em http://localhost:${PORT}`);
  if (generatedPassword) console.log(`\n>>> Senha de acesso gerada (salva em .env): ${generatedPassword}\n`);
});
