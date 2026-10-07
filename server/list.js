// Listas paginadas com ordenação, busca e filtros — tudo validado no servidor.
// Nenhum dado do usuário vira SQL: colunas e expressões de ordenação vêm de uma lista fixa (spec); valores vão como parâmetros.
import { Invalid } from "./validate.js";

const clamp = (raw, min, max, fallback) => {
  if (raw === undefined || raw === "") return fallback;
  if (typeof raw !== "string" || !/^\d{1,9}$/.test(raw)) throw new Invalid("Parâmetro de paginação inválido");
  return Math.min(max, Math.max(min, Number(raw)));
};
const escapeLike = (s) => s.replace(/[\\%_]/g, "\\$&");

/**
 * spec = {
 *   table: "opportunities",
 *   select: "*",                                   // colunas devolvidas
 *   sort: { nome: "name COLLATE NOCASE", ... },    // chave pública -> expressão SQL fixa
 *   defaultSort: "atualizado",
 *   search: ["name", "company"],                   // colunas pesquisadas com LIKE
 *   filters: { stage: "stage", source: "source" }, // parâmetro -> coluna (igualdade)
 *   extra: (query) => ({ sql, params }) | null,    // condições extras fixas
 * }
 */
export async function runList(db, spec, query) {
  if (query === null || typeof query !== "object") throw new Invalid("Consulta inválida");
  for (const [k, v] of Object.entries(query)) if (typeof v !== "string" || v.length > 200) throw new Invalid(`Parâmetro inválido: ${k}`);
  const page = clamp(query.page, 1, 100000, 1);
  const pageSize = clamp(query.pageSize, 1, 100, 25);
  const sortKey = Object.hasOwn(spec.sort, query.sort ?? "") ? query.sort : spec.defaultSort;
  const dir = query.dir === "asc" ? "ASC" : "DESC";

  const where = [];
  const params = [];
  for (const [key, column] of Object.entries(spec.filters ?? {})) {
    const v = query[key];
    if (v !== undefined && v !== "") { where.push(`${column} = ?`); params.push(v); }
  }
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 100) : "";
  if (q && spec.search?.length) {
    const like = `%${escapeLike(q)}%`;
    where.push("(" + spec.search.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(" OR ") + ")");
    params.push(...spec.search.map(() => like));
  }
  const extra = spec.extra?.(query);
  if (extra) { where.push(extra.sql); params.push(...extra.params); }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number((await db.prepare(`SELECT count(*) AS n FROM ${spec.table} ${whereSql}`).get(...params)).n);
  const items = await db
    .prepare(`SELECT ${spec.select ?? "*"} FROM ${spec.table} ${whereSql} ORDER BY ${spec.sort[sortKey]} ${dir}, id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize);
  return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)), sort: sortKey, dir: dir.toLowerCase() };
}
