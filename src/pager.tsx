import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";

/** Paginação acessível: botões rotulados e região anunciada para leitores de tela. */
export function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  if (total === 0) return null;
  return (
    <nav className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-400" aria-label="Paginação">
      <span aria-live="polite">{total} resultado(s) · página {page} de {pages}</span>
      <div className="flex gap-2">
        <button className="btn !px-2.5 !py-1" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /> Anterior</button>
        <button className="btn !px-2.5 !py-1" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Próxima página">Próxima <ChevronRight className="h-4 w-4" /></button>
      </div>
    </nav>
  );
}

/** Cabeçalho de coluna ordenável (botão, foco visível, aria-sort). */
export function SortTh({ label, k, sort, dir, onSort, className = "" }: { label: string; k: string; sort: string; dir: "asc" | "desc"; onSort: (k: string) => void; className?: string }) {
  const active = sort === k;
  return (
    <th className={`th ${className}`} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button className="inline-flex items-center gap-1 rounded hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet" onClick={() => onSort(k)}>
        {label}
        {active && (dir === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
      </button>
    </th>
  );
}
