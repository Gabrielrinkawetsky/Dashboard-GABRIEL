import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";

/** Busca dados da API (GET) e refaz a busca quando a URL muda ou quando `reload()` é chamado. */
export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!url) return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const result = await api.get<T>(url);
      if (mine === seq.current) { setData(result); setError(null); }
    } catch (e) {
      if (mine === seq.current) setError(e instanceof ApiError ? e.message : "Não foi possível carregar.");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load };
}

/** Estado de uma lista paginada (página, ordenação, busca) que vira o texto de consulta da API. */
export type ListState = { page: number; sort: string; dir: "asc" | "desc"; q: string; filters: Record<string, string> };
export const listQuery = (s: ListState, extra: Record<string, string> = {}) => {
  const p = new URLSearchParams({ page: String(s.page), pageSize: "20", sort: s.sort, dir: s.dir, ...extra });
  if (s.q.trim()) p.set("q", s.q.trim());
  for (const [k, v] of Object.entries(s.filters)) if (v) p.set(k, v);
  return p.toString();
};
