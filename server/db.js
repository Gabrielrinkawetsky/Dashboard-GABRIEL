import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";

mkdirSync("data", { recursive: true });
export const db = new DatabaseSync("data/app.db");
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

// Todos os valores monetários são inteiros em centavos.
db.exec(`
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
`);

if (!db.prepare("SELECT 1 FROM services LIMIT 1").get()) {
  const ins = db.prepare("INSERT INTO services (name, default_price) VALUES (?, ?)");
  for (const [n, p] of [["Landing page", 150000], ["E-commerce", 450000], ["Site institucional", 250000], ["Sistema personalizado", 800000], ["Manutenção e suporte", 15000]]) ins.run(n, p);
}

export const tx = (fn) => {
  db.exec("BEGIN");
  try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; }
};
