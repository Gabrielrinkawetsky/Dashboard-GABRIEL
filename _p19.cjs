const fs = require("fs");
const rep = (file, a, b) => { const s = fs.readFileSync(file, "utf8"); if (!s.includes(a)) throw new Error(`${file}: não achei: ${a.slice(0, 80)}`); fs.writeFileSync(file, s.replace(a, b)); console.log("ok", file, "—", a.slice(0, 40).replace(/\n/g, " ")); };

// --- Funnel.tsx: remove a variável sem uso
rep("src/pages/Funnel.tsx", "const OPEN = OPP_STAGES.slice(0, 5);\n", "");
rep("src/pages/Funnel.tsx", "\nvoid OPEN;\n", "\n");

// --- App.tsx
rep("src/App.tsx", "BarChart3, CheckCircle2, FileText,", "BarChart3, CheckCircle2, FileText, Target,");
rep("src/App.tsx", 'import Overview from "./pages/Overview";', 'import Overview from "./pages/Overview";\nimport Funnel from "./pages/Funnel";\nimport LeadForm from "./LeadForm";');
rep("src/App.tsx", '  { id: "visao", label: "Visão geral", icon: LayoutDashboard },', '  { id: "visao", label: "Visão geral", icon: LayoutDashboard },\n  { id: "funil", label: "Funil", icon: Target },');
rep("src/App.tsx", 'if (page === "config") return null;', 'if (page === "config" || page === "funil") return null; // o funil tem busca e filtros próprios');
rep("src/App.tsx", "const Page = { visao: Overview,", "const Page = { visao: Overview, funil: Funnel,");
rep("src/App.tsx", "  if (auth === null) return", '  // Página pública de captura de leads: aberta a qualquer visitante, sem login.\n  if (location.pathname.replace(/\\/+$/, "") === "/captura") return <LeadForm />;\n  if (auth === null) return');

// --- Settings.tsx: cartão "Captura de leads"
rep("src/pages/Settings.tsx", "        <PasswordSettings />\n", `        <PasswordSettings />
        <Card>
          <Title>Captura de leads</Title>
          <p className="mb-3 text-sm text-slate-400">Divulgue este endereço (bio do Instagram, WhatsApp, e-mail). Quem preencher entra sozinho no Funil como "Novo lead", sem duplicar contatos.</p>
          <Field label="Endereço do formulário">
            <div className="flex gap-2"><input className="field" readOnly value={captureUrl} /><button type="button" className="btn" aria-label="Copiar endereço do formulário" onClick={() => void copy(captureUrl)}><Copy className="h-4 w-4" /></button></div>
          </Field>
          <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); void run(() => api.put("settings", { lead_allowed_origins: origins }), "Sites autorizados salvos"); }}>
            <Field label="Sites que podem enviar leads para cá" hint="Só se você hospedar o formulário em outro site. Separe por vírgula, no formato https://seusite.com.br (sem barra no final). Vazio = apenas o formulário acima.">
              <input className="field" value={origins} placeholder="https://seusite.com.br" onChange={(e) => setOrigins(e.target.value)} />
            </Field>
            <button className="btn">Salvar sites autorizados</button>
          </form>
          <details className="mt-3 text-sm text-slate-400">
            <summary className="cursor-pointer">Como usar em outro site</summary>
            <pre className="mt-2 overflow-x-auto rounded-xl bg-black/30 p-3 text-xs text-slate-300">{embed}</pre>
          </details>
        </Card>
`);
rep("src/pages/Settings.tsx", "  const hook = `${location.origin}/api/webhooks/payments`;", `  const hook = \`\${location.origin}/api/webhooks/payments\`;
  const captureUrl = \`\${location.origin}/captura\`;
  const [origins, setOrigins] = useState(d.settings.lead_allowed_origins ?? "");
  const embed = \`fetch("\${location.origin}/api/public/lead", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name, email, phone, company, service, message, website: "" }),
});
// "website" é o campo-isca contra robôs: envie sempre vazio.\`;`);
