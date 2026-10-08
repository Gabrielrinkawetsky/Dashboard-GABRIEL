// Datas de calendário são texto YYYY-MM-DD no horário de Brasília (pela variável TZ é possível trocar).
// Não use toISOString(): ele dá a data em UTC, que depois das 21h já é o dia seguinte.
process.env.TZ ??= "America/Sao_Paulo";

export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const today = () => ymd(new Date());

// Mesmo dia n meses depois; em mês mais curto, o último dia (31/01 → 28/02 → 31/03)
export const addMonths = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  return ymd(new Date(y, m - 1 + n, Math.min(d, new Date(y, m + n, 0).getDate())));
};

// Soma n dias a uma data YYYY-MM-DD (ao meio-dia, para não sofrer com horário de verão)
export const addDays = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  return ymd(new Date(y, m - 1, d + n, 12));
};
// Dias de calendário entre duas datas (b - a)
export const diffDays = (a, b) => {
  const t = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86_400_000);
};
