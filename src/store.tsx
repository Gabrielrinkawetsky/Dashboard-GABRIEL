import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";
import type { Data } from "./types";
import { emptyFilters, type Filters } from "./lib";

type Toast = { id: number; kind: "ok" | "err"; text: string };
type Ctx = {
  data: Data | null;
  loading: boolean;
  loadError: string | null;
  reload: () => Promise<void>;
  filters: Filters;
  setFilters: (f: Partial<Filters>) => void;
  resetFilters: () => void;
  toasts: Toast[];
  notify: (kind: "ok" | "err", text: string) => void;
  /** Executa uma ação, recarrega os dados e mostra sucesso ou erro. */
  run: (fn: () => Promise<unknown>, okText?: string) => Promise<boolean>;
};

const StoreCtx = createContext<Ctx>(null as never);
export const useStore = () => useContext(StoreCtx);

export function StoreProvider({ children, onUnauthorized }: { children: ReactNode; onUnauthorized: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setF] = useState<Filters>(emptyFilters);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((kind: "ok" | "err", text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const reload = useCallback(async () => {
    try {
      setData(await api.data());
      setLoadError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onUnauthorized();
      else setLoadError("Não foi possível carregar os dados. Verifique se o servidor está rodando.");
    } finally {
      setLoading(false);
    }
  }, [onUnauthorized]);

  useEffect(() => { void reload(); }, [reload]);

  const run = useCallback(async (fn: () => Promise<unknown>, okText?: string) => {
    try {
      await fn();
      await reload();
      if (okText) notify("ok", okText);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onUnauthorized();
      else notify("err", e instanceof Error ? e.message : "Erro inesperado");
      return false;
    }
  }, [reload, notify, onUnauthorized]);

  const value = useMemo<Ctx>(() => ({
    data, loading, loadError, reload, filters, toasts, notify, run,
    setFilters: (f) => setF((p) => ({ ...p, ...f })),
    resetFilters: () => setF(emptyFilters),
  }), [data, loading, loadError, reload, filters, toasts, notify, run]);

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}
