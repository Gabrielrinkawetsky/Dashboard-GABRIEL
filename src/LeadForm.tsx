import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Send } from "lucide-react";

const SERVICES = ["Landing page", "E-commerce", "Site institucional", "Sistema personalizado", "Manutenção e suporte"];

/** Página PÚBLICA de captura de leads (sem login): /captura. Só envia um contato; não lê nada do painel. */
export default function LeadForm() {
  const [brand, setBrand] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", email: "", phone: "", company: "", service: "", message: "", website: "" });
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/public/brand").then((r) => r.json()).then((j: { company_name: string | null }) => setBrand(j.company_name)).catch(() => {});
    document.title = "Fale conosco";
  }, []);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState("sending");
    setError("");
    try {
      const res = await fetch("/api/public/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Não foi possível enviar. Tente novamente.");
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar. Tente novamente.");
      setState("idle");
    }
  };

  return (
    <main className="grid min-h-screen place-items-center px-5 py-10">
      <div className="glass w-full max-w-xl rounded-3xl p-7 sm:p-10">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-violet">{brand ?? "Contato"}</p>
        {state === "done" ? (
          <div className="py-8 text-center" role="status">
            <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-emerald-300" aria-hidden />
            <h1 className="text-2xl font-semibold">Recebemos sua mensagem!</h1>
            <p className="mt-3 text-sm text-slate-400">Entraremos em contato em breve pelo e-mail ou telefone informado.</p>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-semibold">Vamos conversar sobre o seu projeto?</h1>
            <p className="mb-6 mt-2 text-sm text-slate-400">Conte um pouco sobre o que você precisa. Informe um e-mail ou telefone para o retorno.</p>
            <form onSubmit={submit} className="space-y-4" noValidate={false}>
              <div>
                <label htmlFor="lead-name" className="mb-1 block text-sm">Seu nome *</label>
                <input id="lead-name" className="field" required minLength={2} maxLength={120} autoComplete="name" value={f.name} onChange={set("name")} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="lead-email" className="mb-1 block text-sm">E-mail</label>
                  <input id="lead-email" className="field" type="email" maxLength={160} autoComplete="email" value={f.email} onChange={set("email")} />
                </div>
                <div>
                  <label htmlFor="lead-phone" className="mb-1 block text-sm">Telefone / WhatsApp</label>
                  <input id="lead-phone" className="field" type="tel" maxLength={40} autoComplete="tel" value={f.phone} onChange={set("phone")} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="lead-company" className="mb-1 block text-sm">Empresa</label>
                  <input id="lead-company" className="field" maxLength={120} autoComplete="organization" value={f.company} onChange={set("company")} />
                </div>
                <div>
                  <label htmlFor="lead-service" className="mb-1 block text-sm">O que você precisa?</label>
                  <select id="lead-service" className="field" value={f.service} onChange={set("service")}>
                    <option value="">Selecione…</option>
                    {SERVICES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="lead-message" className="mb-1 block text-sm">Mensagem</label>
                <textarea id="lead-message" className="field" rows={4} maxLength={2000} value={f.message} onChange={set("message")} />
              </div>
              {/* Campo-isca: escondido de pessoas; robôs costumam preenchê-lo. */}
              <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
                <label htmlFor="lead-website">Não preencha este campo</label>
                <input id="lead-website" tabIndex={-1} autoComplete="off" value={f.website} onChange={set("website")} />
              </div>
              {error && <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-3 text-sm text-rose-300">{error}</p>}
              <button className="btn btn-primary w-full justify-center !py-3" disabled={state === "sending" || !f.name.trim() || (!f.email.trim() && !f.phone.trim())}>
                {state === "sending" ? "Enviando…" : "Enviar mensagem"} {state !== "sending" && <Send className="h-4 w-4" aria-hidden />}
              </button>
              <p className="text-center text-xs text-slate-500">Usamos seus dados apenas para retornar o contato.</p>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
