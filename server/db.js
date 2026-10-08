import { createClient as createRemote } from "@libsql/client/web";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";

// Produção (Vercel): banco Turso via TURSO_DATABASE_URL + TURSO_AUTH_TOKEN. Sem elas: arquivo local data/app.db.
// O cliente remoto é só HTTP (sem módulo nativo); o de arquivo só é carregado quando usado.
const url = process.env.TURSO_DATABASE_URL || "file:data/app.db";
if (url.startsWith("file:")) mkdirSync("data", { recursive: true });
const createClient = url.startsWith("file:") ? (await import("@libsql/client")).createClient : createRemote;
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined, timeout: 5000 });

// Dentro de tx(), toda consulta vai para a transação aberta (sem precisar passá-la adiante).
const current = new AsyncLocalStorage();
const execute = async (sql, args) => {
  const r = await (current.getStore() ?? client).execute({ sql, args: args.map((a) => (a === undefined ? null : a)) });
  return { rows: r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]]))), changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid === undefined ? undefined : Number(r.lastInsertRowid) };
};

// Mesma forma do node:sqlite (prepare().get/all/run, exec), mas assíncrona.
export const db = {
  prepare: (sql) => ({
    get: async (...args) => (await execute(sql, args)).rows[0],
    all: async (...args) => (await execute(sql, args)).rows,
    run: async (...args) => { const r = await execute(sql, args); return { changes: r.changes, lastInsertRowid: r.lastInsertRowid }; },
  }),
  exec: (sql) => (current.getStore() ?? client).executeMultiple(sql),
  close: () => client.close(),
};

/** Transação de escrita: tudo ou nada, e serializada com as outras gravações. */
export const tx = async (fn) => {
  if (current.getStore()) return fn();
  const t = await client.transaction("write");
  try {
    const r = await current.run(t, fn);
    await t.commit();
    return r;
  } catch (e) {
    await t.rollback().catch(() => {});
    throw e;
  } finally {
    t.close();
  }
};

if (url.startsWith("file:")) await db.exec("PRAGMA journal_mode = WAL;");

// Todos os valores monetários são inteiros em centavos.
await db.exec(`
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
CREATE TABLE IF NOT EXISTS auth_users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES auth_users(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS auth_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
`);

await tx(async () => {
  if (await db.prepare("SELECT 1 FROM services LIMIT 1").get()) return;
  const ins = db.prepare("INSERT INTO services (name, default_price) VALUES (?, ?)");
  for (const [n, p] of [["Landing page", 150000], ["E-commerce", 450000], ["Site institucional", 250000], ["Sistema personalizado", 800000], ["Manutenção e suporte", 15000]]) await ins.run(n, p);
});

// Colunas adicionadas depois (bancos antigos ganham a coluna, sem perder dados).
const addColumn = async (table, column, def) => {
  const cols = await db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all();
  if (!cols.some((c) => c.name === column)) await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
};
await addColumn("clients", "cpf_cnpj", "TEXT");
await addColumn("clients", "asaas_customer_id", "TEXT");
await addColumn("installments", "asaas_payment_id", "TEXT");
await addColumn("installments", "asaas_invoice_url", "TEXT");
await addColumn("installments", "asaas_status", "TEXT");
await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS installments_asaas ON installments(asaas_payment_id) WHERE asaas_payment_id IS NOT NULL");
