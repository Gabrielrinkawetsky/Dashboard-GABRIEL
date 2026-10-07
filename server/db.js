// Banco de dados: libSQL (SQLite). Em produção (Vercel) usa o Turso; localmente, o arquivo data/app.db.
//   TURSO_DATABASE_URL  libsql://seu-banco.turso.io   (vazio = arquivo local file:data/app.db)
//   TURSO_AUTH_TOKEN    token do banco (só no servidor)
// A interface imita a anterior (prepare().get/all/run), agora assíncrona: use sempre "await".
//
// Se o banco não estiver disponível (na Vercel sem Turso, ou credenciais erradas) o servidor NÃO cai: ele sobe,
// guarda a causa em dbState.problem e responde 503 com uma mensagem clara (ver server/index.js).
import { mkdirSync } from "node:fs";

export const dbState = { problem: null };
export class DbNotConfigured extends Error {
  constructor(message) { super(message); this.code = 503; }
}

// Procura o banco Turso. Nome padrão: TURSO_DATABASE_URL + TURSO_AUTH_TOKEN. A integração da Vercel permite um
// "prefixo personalizado" (ex.: ARMAZENAR_URL + ARMAZENAR_AUTH_TOKEN), então também aceitamos qualquer variável
// terminada em URL cujo valor seja um endereço *.turso.io, com o token de mesmo prefixo.
const findTurso = () => {
  const env = process.env;
  if (env.TURSO_DATABASE_URL) return { url: env.TURSO_DATABASE_URL, token: env.TURSO_AUTH_TOKEN };
  const urlKey = Object.keys(env).find((k) => /URL$/.test(k) && /^(libsql|https?|wss?):\/\/[^\s]*turso\.io/i.test(env[k] ?? ""));
  if (!urlKey) return null;
  const prefix = urlKey.replace(/(DATABASE_)?URL$/, "");
  const tokenKey = [prefix + "AUTH_TOKEN", ...Object.keys(env).filter((k) => /AUTH_TOKEN$/.test(k))].find((k) => env[k]);
  return { url: env[urlKey], token: tokenKey ? env[tokenKey] : undefined };
};
const turso = findTurso();
const remote = Boolean(turso);
// Na Vercel o disco é temporário: sem o banco da nuvem os dados se perderiam.
if (process.env.VERCEL && !remote && !process.env.ALLOW_LOCAL_DB)
  dbState.problem = "Banco de dados não configurado: conecte o Turso ao projeto na Vercel (Storage → Turso) e faça um novo deploy.";

export let client = null;
if (!dbState.problem) {
  // Remoto (Turso): cliente web, 100% JavaScript (funciona na Vercel sem binário nativo). Local: cliente com suporte a arquivo.
  const { createClient } = remote ? await import("@libsql/client/web") : await import("@libsql/client");
  if (!remote) mkdirSync("data", { recursive: true });
  client = createClient({
    url: turso?.url || "file:data/app.db",
    authToken: turso?.token,
  });
}

const need = () => { if (dbState.problem) throw new DbNotConfigured(dbState.problem); };
const plain = (rs, row) => Object.fromEntries(rs.columns.map((c, i) => [c, row[i]]));
const norm = (args) => args.map((a) => (a === undefined ? null : a));

/** Cria a interface (prepare/exec) sobre uma função que executa SQL — o cliente normal ou uma transação. */
const wrap = (execute, executeMultiple) => ({
  prepare: (sql) => ({
    get: async (...args) => { need(); const rs = await execute({ sql, args: norm(args) }); return rs.rows[0] ? plain(rs, rs.rows[0]) : undefined; },
    all: async (...args) => { need(); const rs = await execute({ sql, args: norm(args) }); return rs.rows.map((r) => plain(rs, r)); },
    run: async (...args) => { need(); const rs = await execute({ sql, args: norm(args) }); return { changes: rs.rowsAffected, lastInsertRowid: Number(rs.lastInsertRowid ?? 0) }; },
  }),
  exec: (sql) => { need(); return executeMultiple(sql); },
});

export const db = {
  ...wrap((s) => client.execute(s), (sql) => client.executeMultiple(sql)),
  close: () => client?.close(),
};

/**
 * Transação de escrita: tudo ou nada, e uma por vez (BEGIN IMMEDIATE). A função recebe a interface da transação
 * ("d") — dentro dela use sempre d.prepare(...), nunca db.prepare(...), senão a consulta sai da transação.
 */
export async function tx(fn) {
  need();
  const t = await client.transaction("write");
  try {
    const result = await fn(wrap((s) => t.execute(s), (sql) => t.executeMultiple(sql)));
    await t.commit();
    return result;
  } catch (e) {
    await t.rollback().catch(() => {});
    throw e;
  } finally {
    t.close();
  }
}

// Esquema. Todos os valores monetários são inteiros em centavos.
if (!dbState.problem) {
  try {
    if (!remote) await client.execute("PRAGMA foreign_keys = ON").catch(() => {});
    await client.executeMultiple(`
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, default_price INTEGER DEFAULT 0, active INTEGER DEFAULT 1, demo INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, company TEXT, email TEXT, phone TEXT, notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, demo INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), service TEXT NOT NULL, scope TEXT,
  value INTEGER NOT NULL, deadline TEXT, valid_until TEXT, status TEXT NOT NULL DEFAULT 'rascunho',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, decided_at TEXT, demo INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY, proposal_id INTEGER UNIQUE REFERENCES proposals(id), client_id INTEGER NOT NULL REFERENCES clients(id),
  name TEXT, service TEXT NOT NULL, scope TEXT, stage TEXT NOT NULL DEFAULT 'Briefing', deadline TEXT, owner TEXT,
  progress INTEGER DEFAULT 0, checklist TEXT DEFAULT '[]', notes TEXT, links TEXT, cancelled INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, demo INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS project_history (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  at TEXT DEFAULT CURRENT_TIMESTAMP, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS installments (
  id INTEGER PRIMARY KEY, proposal_id INTEGER REFERENCES proposals(id), project_id INTEGER REFERENCES projects(id),
  client_id INTEGER NOT NULL REFERENCES clients(id), label TEXT, amount INTEGER NOT NULL, due_date TEXT NOT NULL, demo INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, installment_id INTEGER REFERENCES installments(id), client_id INTEGER REFERENCES clients(id),
  project_id INTEGER REFERENCES projects(id), amount INTEGER NOT NULL, type TEXT NOT NULL DEFAULT 'payment',
  paid_at TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', external_id TEXT, note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, demo INTEGER DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS payments_ext ON payments(source, external_id, type) WHERE external_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY, project_id INTEGER REFERENCES projects(id), description TEXT NOT NULL, amount INTEGER NOT NULL,
  date TEXT NOT NULL, demo INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS recurring (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), name TEXT NOT NULL, kind TEXT,
  amount INTEGER NOT NULL, period TEXT NOT NULL DEFAULT 'mensal', status TEXT NOT NULL DEFAULT 'ativo', next_due TEXT, demo INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT NOT NULL, provider TEXT NOT NULL, payload TEXT, received_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (provider, event_id));
CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, company TEXT, email TEXT, phone TEXT, source TEXT, service TEXT,
  value INTEGER NOT NULL DEFAULT 0, stage TEXT NOT NULL DEFAULT 'Novo lead', next_contact TEXT, owner TEXT, notes TEXT, lost_reason TEXT,
  client_id INTEGER REFERENCES clients(id), proposal_id INTEGER REFERENCES proposals(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, closed_at TEXT, demo INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS opportunities_stage ON opportunities(stage);
CREATE INDEX IF NOT EXISTS opportunities_email ON opportunities(email);
CREATE INDEX IF NOT EXISTS opportunities_next_contact ON opportunities(next_contact);
CREATE TABLE IF NOT EXISTS opportunity_events (
  id INTEGER PRIMARY KEY, opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  at TEXT DEFAULT CURRENT_TIMESTAMP, text TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS opportunity_events_opp ON opportunity_events(opportunity_id);
`);

    if (!(await db.prepare("SELECT 1 FROM services LIMIT 1").get())) {
      for (const [n, p] of [["Landing page", 150000], ["E-commerce", 450000], ["Site institucional", 250000], ["Sistema personalizado", 800000], ["Manutenção e suporte", 15000]])
        await db.prepare("INSERT INTO services (name, default_price) VALUES (?, ?)").run(n, p);
    }
  } catch (e) {
    dbState.problem = "Não foi possível conectar ao banco de dados. Confira TURSO_DATABASE_URL e TURSO_AUTH_TOKEN no projeto da Vercel.";
    console.error("[db] falha ao iniciar o banco:", e?.message ?? e);
  }
}
