import { useEffect, useState, type ReactNode } from "react";
import { Inbox, X } from "lucide-react";
import { fromCents, toCents } from "./lib";

export const Card = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <div className={`glass rounded-2xl p-4 sm:p-5 ${className}`}>{children}</div>
);

export const Title = ({ children, action }: { children: ReactNode; action?: ReactNode }) => (
  <div className="mb-3 flex items-center justify-between gap-2">
    <h2 className="text-sm font-semibold text-slate-100">{children}</h2>
    {action}
  </div>
);

const tones: Record<string, string> = {
  good: "bg-emerald-400/15 text-emerald-300",
  bad: "bg-rose-400/15 text-rose-300",
  warn: "bg-amber-400/15 text-amber-300",
  violet: "bg-violet-400/15 text-violet-300",
  muted: "bg-white/8 text-slate-300",
};
export const Badge = ({ tone = "muted", children }: { tone?: keyof typeof tones; children: ReactNode }) => (
  <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>
);
export const DemoTag = () => <Badge tone="warn">Exemplo</Badge>;

export const statusTone: Record<string, string> = {
  rascunho: "muted", enviada: "violet", aprovada: "good", recusada: "bad", expirada: "warn",
  paga: "good", atrasada: "bad", parcial: "warn", aberta: "muted",
  ativo: "good", pausado: "warn", cancelado: "bad",
};

export function Empty({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <Inbox className="h-8 w-8 text-slate-500" />
      <p className="font-medium text-slate-200">{title}</p>
      {text && <p className="max-w-sm text-sm text-slate-400">{text}</p>}
      {action}
    </div>
  );
}

export const Skeleton = ({ className = "h-24" }: { className?: string }) => <div className={`skeleton ${className}`} />;

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={onClose}>
      <div role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}
        className={`glass max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-[#14141d] p-5 sm:rounded-3xl ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"}`}
        style={{ background: "#14141d" }}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button className="rounded-lg p-1 text-slate-400 hover:bg-white/10" onClick={onClose} aria-label="Fechar"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <label className="block">
    <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
    {children}
    {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
  </label>
);

/** Campo de valor em reais; controla o texto e entrega centavos. */
export function MoneyInput({ cents, onChange, ...rest }: { cents: number; onChange: (c: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  const [text, setText] = useState(cents ? fromCents(cents) : "");
  useEffect(() => { if (toCents(text) !== cents) setText(cents ? fromCents(cents) : ""); }, [cents]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input {...rest} className="field" inputMode="decimal" placeholder="0,00" value={text}
      onChange={(e) => { setText(e.target.value); onChange(toCents(e.target.value)); }} />
  );
}

export function Confirm({ text, onYes, onNo }: { text: string; onYes: () => void; onNo: () => void }) {
  return (
    <Modal title="Confirmar" onClose={onNo}>
      <p className="mb-5 text-sm text-slate-300">{text}</p>
      <div className="flex justify-end gap-2">
        <button className="btn" onClick={onNo}>Cancelar</button>
        <button className="btn btn-primary" onClick={onYes}>Confirmar</button>
      </div>
    </Modal>
  );
}

export const Progress = ({ value }: { value: number }) => (
  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
    <div className="h-full rounded-full bg-gradient-to-r from-violet-strong to-violet" style={{ width: `${Math.min(100, value)}%` }} />
  </div>
);

export const PageHeader = ({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) => (
  <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {sub && <p className="text-sm text-slate-400">{sub}</p>}
    </div>
    <div className="flex flex-wrap gap-2">{children}</div>
  </div>
);
