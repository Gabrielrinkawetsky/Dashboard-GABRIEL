import Login from "./Login";
import { useCallback, useEffect, useState } from "react";
import {
  BarChart3, CheckCircle2, FileText, Target, FolderKanban, LayoutDashboard, LogOut, Repeat, Search, Settings, SlidersHorizontal, Users, Wallet, XCircle,
} from "lucide-react";
import { api } from "./api";
import { StoreProvider, useStore } from "./store";
import { Skeleton } from "./ui";
import { STAGES } from "./types";
import Overview from "./pages/Overview";
import Funnel from "./pages/Funnel";
import LeadForm from "./LeadForm";
import Clients from "./pages/Clients";
import Proposals from "./pages/Proposals";
import Projects from "./pages/Projects";
import Finance from "./pages/Finance";
import RecurringPage from "./pages/Recurring";
import Reports from "./pages/Reports";
import SettingsPage from "./pages/Settings";

const NAV = [
  { id: "visao", label: "Visão geral", icon: LayoutDashboard },
  { id: "funil", label: "Funil", icon: Target },
  { id: "clientes", label: "Clientes", icon: Users },
  { id: "propostas", label: "Propostas", icon: FileText },
  { id: "projetos", label: "Projetos", icon: FolderKanban },
  { id: "financeiro", label: "Financeiro", icon: Wallet },
  { id: "recorrencias", label: "Recorrências", icon: Repeat },
  { id: "relatorios", label: "Relatórios", icon: BarChart3 },
  { id: "config", label: "Configurações", icon: Settings },
] as const;
type PageId = (typeof NAV)[number]["id"];

const STATUS_OPTIONS: Partial<Record<PageId, string[]>> = {
  propostas: ["rascunho", "enviada", "aprovada", "recusada", "expirada"],
  projetos: [...STAGES, "Cancelado"],
  financeiro: ["aberta", "parcial", "paga", "atrasada"],
  recorrencias: ["ativo", "pausado", "cancelado"],
};
const PRESETS = [["mes", "Este mês"], ["30d", "30 dias"], ["90d", "90 dias"], ["ano", "Este ano"], ["tudo", "Tudo"], ["custom", "Personalizado"]] as const;

const pageFromHash = (): PageId => (NAV.find((n) => n.id === location.hash.slice(1))?.id ?? "visao");

function FilterBar({ page }: { page: PageId }) {
  const { data, filters: f, setFilters, resetFilters } = useStore();
  const [show, setShow] = useState(false); // no celular os filtros ficam recolhidos
  if (page === "config" || page === "funil") return null; // o funil tem busca e filtros próprios
  const onlyPeriod = page === "visao"; // a visão geral só usa o período
  const statuses = onlyPeriod ? undefined : STATUS_OPTIONS[page];
  const usePeriod = !["clientes", "recorrencias", "projetos"].includes(page);
  const useSvc = !onlyPeriod && !["clientes", "recorrencias"].includes(page);
  return (
    <div className="glass mb-5 flex flex-wrap items-center gap-2 rounded-2xl p-3">
      <div className={`relative min-w-40 flex-1 ${onlyPeriod ? "hidden" : ""}`}>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input className="field pl-9" placeholder="Buscar…" aria-label="Buscar" value={f.q} onChange={(e) => setFilters({ q: e.target.value })} />
      </div>
      <button className="btn sm:hidden" aria-expanded={show} onClick={() => setShow(!show)}>
        <SlidersHorizontal className="h-4 w-4" /> Filtros
      </button>
      <div className={`${show ? "flex" : "hidden"} w-full flex-wrap items-center gap-2 sm:contents`}>
      {page !== "clientes" && !onlyPeriod && (
        <select className="field w-auto" aria-label="Cliente" value={f.clientId} onChange={(e) => setFilters({ clientId: e.target.value })}>
          <option value="">Todos os clientes</option>
          {data?.clients.map((c) => <option key={c.id} value={c.id}>{c.company || c.name}</option>)}
        </select>
      )}
      {useSvc && (
        <select className="field w-auto" aria-label="Serviço" value={f.service} onChange={(e) => setFilters({ service: e.target.value })}>
          <option value="">Todos os serviços</option>
          {data?.services.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
      )}
      {statuses && (
        <select className="field w-auto" aria-label="Status" value={f.status} onChange={(e) => setFilters({ status: e.target.value })}>
          <option value="">Todos os status</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      )}
      {usePeriod && (
        <select className="field w-auto" aria-label="Período" value={f.preset} onChange={(e) => setFilters({ preset: e.target.value as typeof f.preset })}>
          {PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      )}
      {usePeriod && f.preset === "custom" && (
        <>
          <input className="field w-auto" type="date" aria-label="De" value={f.from} onChange={(e) => setFilters({ from: e.target.value })} />
          <input className="field w-auto" type="date" aria-label="Até" value={f.to} onChange={(e) => setFilters({ to: e.target.value })} />
        </>
      )}
      <button className="btn" onClick={resetFilters}>Limpar</button>
      </div>
    </div>
  );
}

function Toasts() {
  const { toasts } = useStore();
  return (
    <div className="pointer-events-none fixed bottom-20 right-4 z-[60] flex flex-col gap-2 lg:bottom-4" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`glass pointer-events-auto flex items-center gap-2 rounded-xl px-4 py-3 text-sm shadow-xl ${t.kind === "ok" ? "text-emerald-300" : "text-rose-300"}`} style={{ background: "#14141d" }}>
          {t.kind === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {t.text}
        </div>
      ))}
    </div>
  );
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const { data, loading, loadError, reload, setFilters } = useStore();
  const [page, setPage] = useState<PageId>(pageFromHash());
  useEffect(() => {
    const h = () => { setPage(pageFromHash()); setFilters({ status: "" }); };
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, [setFilters]);
  const go = (id: string) => { location.hash = id; };

  const owner = data?.settings.owner_name || "Gabriel Ribeiro Silva";
  const company = data?.settings.company_name || "GR Studio";
  const Page = { visao: Overview, funil: Funnel, clientes: Clients, propostas: Proposals, projetos: Projects, financeiro: Finance, recorrencias: RecurringPage, relatorios: Reports, config: SettingsPage }[page];

  return (
    <div className="flex min-h-screen">
      <aside className="glass sticky top-0 m-4 hidden h-[calc(100vh-2rem)] w-60 shrink-0 flex-col rounded-3xl p-4 lg:flex">
        <div className="mb-6 flex items-center gap-3 px-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-violet to-violet-strong font-bold text-[#14102a]">{company[0]?.toUpperCase()}</div>
          <span className="truncate font-semibold">{company}</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => go(id)} aria-current={page === id ? "page" : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${page === id ? "bg-violet/15 text-violet" : "text-slate-400 hover:bg-white/5 hover:text-slate-100"}`}>
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </nav>
        <button onClick={onLogout} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-400 hover:bg-white/5"><LogOut className="h-4 w-4" /> Sair</button>
      </aside>

      <main className="min-w-0 flex-1 px-4 pb-28 pt-4 lg:px-4 lg:pb-8">
        <header className="mb-5 flex items-center justify-between gap-3">
          <div className="lg:hidden">
            <p className="text-xs text-slate-400">{company}</p>
            <p className="text-sm font-semibold">{NAV.find((n) => n.id === page)?.label}</p>
          </div>
          <div className="hidden text-sm text-slate-400 lg:block">Olá, <span className="font-medium text-slate-100">{owner.split(" ")[0]}</span></div>
          <div className="flex items-center gap-3">
            <div className="text-right"><p className="text-sm font-medium leading-tight">{owner}</p><p className="text-xs text-slate-500">Administrador</p></div>
            <img src="/avatar.jpeg" alt={owner} width={40} height={40} className="h-10 w-10 rounded-full object-cover ring-2 ring-violet/60" style={{ objectPosition: "50% 30%" }} />
            <button onClick={onLogout} className="rounded-lg p-2 text-slate-400 hover:bg-white/10 lg:hidden" aria-label="Sair"><LogOut className="h-4 w-4" /></button>
          </div>
        </header>

        <FilterBar page={page} />

        {loading ? (
          <div className="space-y-4"><div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} />)}</div><Skeleton className="h-64" /></div>
        ) : loadError || !data ? (
          <div className="glass rounded-2xl p-8 text-center">
            <p className="mb-3 text-rose-300">{loadError}</p>
            <button className="btn btn-primary" onClick={() => void reload()}>Tentar novamente</button>
          </div>
        ) : <Page go={go} />}
      </main>

      <nav className="glass fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto px-2 py-2 lg:hidden" style={{ background: "rgba(14,14,22,.92)" }}>
        {NAV.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => go(id)} aria-label={label} aria-current={page === id ? "page" : undefined}
            className={`flex min-w-[4.5rem] flex-1 flex-col items-center gap-1 rounded-xl px-2 py-1.5 text-[11px] ${page === id ? "bg-violet/15 text-violet" : "text-slate-400"}`}>
            <Icon className="h-5 w-5" /> <span className="whitespace-nowrap">{label.split(" ")[0]}</span>
          </button>
        ))}
      </nav>
      <Toasts />
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState<boolean | null>(null);
  useEffect(() => { api.session().then((s) => setAuth(s.authenticated)).catch(() => setAuth(false)); }, []);
  const out = useCallback(() => setAuth(false), []);
  // Página pública de captura de leads: aberta a qualquer visitante, sem login.
  if (location.pathname.replace(/\/+$/, "") === "/captura") return <LeadForm />;
  if (auth === null) return <div className="grid min-h-screen place-items-center"><Skeleton className="h-10 w-40" /></div>;
  if (!auth) return <Login onDone={() => setAuth(true)} />;
  return (
    <StoreProvider onUnauthorized={out}>
      <Shell onLogout={() => { void api.logout().finally(out); }} />
    </StoreProvider>
  );
}
