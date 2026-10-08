// Validação estrita de entrada. Qualquer valor fora do esperado vira erro 400 (nunca 500) e nada é gravado.
export class Invalid extends Error {
  constructor(message, code = 400) { super(message); this.code = code; }
}

export const MAX_MONEY = 100_000_000_000; // R$ 1 bilhão, em centavos
export const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export const isDate = (s) =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;

const empty = (v) => v === undefined || v === null || v === "";

export function text(v, field, max, required = false) {
  if (empty(v)) { if (required) throw new Invalid(`Campo obrigatório: ${field}`); return null; }
  if (typeof v !== "string") throw new Invalid(`${field}: texto inválido`);
  const s = v.trim();
  if (!s) { if (required) throw new Invalid(`Campo obrigatório: ${field}`); return null; }
  if (s.length > max) throw new Invalid(`${field}: máximo de ${max} caracteres`);
  return s;
}

export function email(v, field = "email") {
  const s = text(v, field, 160);
  if (s !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new Invalid(`${field}: e-mail inválido`);
  return s;
}

/** Inteiro (aceita número ou texto só com dígitos, como vem de <select>). Decimais são recusados. */
export function int(v, field, { min = 0, max = Number.MAX_SAFE_INTEGER, required = false } = {}) {
  if (empty(v)) { if (required) throw new Invalid(`Campo obrigatório: ${field}`); return null; }
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d{1,15}$/.test(v.trim()) ? Number(v) : NaN;
  if (!Number.isSafeInteger(n)) throw new Invalid(`${field}: número inteiro inválido`);
  if (n < min || n > max) throw new Invalid(`${field}: fora do intervalo permitido`);
  return n;
}

export const money = (v, field, required = false) => int(v, field, { min: 1, max: MAX_MONEY, required });

export function date(v, field, required = false) {
  if (empty(v)) { if (required) throw new Invalid(`Campo obrigatório: ${field}`); return null; }
  if (!isDate(v)) throw new Invalid(`${field}: data inválida (use AAAA-MM-DD)`);
  return v;
}

export function oneOf(v, field, list, required = false) {
  if (empty(v)) { if (required) throw new Invalid(`Campo obrigatório: ${field}`); return null; }
  if (typeof v !== "string" || !list.includes(v)) throw new Invalid(`${field}: valor inválido`);
  return v;
}

export function bool01(v, field) {
  if (v === true || v === 1 || v === "1") return 1;
  if (v === false || v === 0 || v === "0") return 0;
  throw new Invalid(`${field}: use 0 ou 1`);
}

export function checklist(v) {
  if (!Array.isArray(v)) throw new Invalid("checklist: precisa ser uma lista");
  if (v.length > 100) throw new Invalid("checklist: máximo de 100 itens");
  return v.map((item) => {
    if (!isPlainObject(item)) throw new Invalid("checklist: item inválido");
    return { text: text(item.text, "item do checklist", 200, true), done: Boolean(item.done) };
  });
}

/** CPF (11 dígitos) ou CNPJ (14), com dígitos verificadores. Guarda só os números. */
export function cpfCnpj(v, field = "CPF/CNPJ") {
  const s = text(v, field, 20);
  if (s === null) return null;
  const n = s.replace(/[.\-/\s]/g, "");
  const dv = (digits, weights) => { const r = weights.reduce((a, w, i) => a + w * Number(digits[i]), 0) % 11; return r < 2 ? 0 : 11 - r; };
  const ok = /^\d+$/.test(n) && !/^(\d)\1+$/.test(n) && (
    n.length === 11 ? dv(n, [10, 9, 8, 7, 6, 5, 4, 3, 2]) === +n[9] && dv(n, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) === +n[10]
    : n.length === 14 ? dv(n, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === +n[12] && dv(n, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === +n[13]
    : false);
  if (!ok) throw new Invalid(`${field} inválido`);
  return n;
}
