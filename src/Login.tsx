import { useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react';
import { api } from './api';
export default function Login({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api.login(username, password); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível entrar. Tente novamente.'); }
    finally { setBusy(false); }
  };
  return <main className="grid min-h-screen place-items-center px-5 py-10">
    <div className="glass grid w-full max-w-5xl overflow-hidden rounded-3xl shadow-2xl lg:grid-cols-2">
      <section className="relative flex flex-col justify-between gap-12 bg-violet/5 p-8 lg:p-12">
        <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-violet font-bold text-ink">G</div><span className="font-semibold">Gabriel • Gestão</span></div>
        <div><p className="mb-5 text-xs font-semibold uppercase tracking-[0.2em] text-violet">Seu espaço de trabalho</p><h1 className="text-3xl font-semibold leading-tight lg:text-4xl">Seu negócio.<br />Tudo sob controle.</h1><p className="mt-5 max-w-sm text-sm leading-7 text-slate-400">Clientes, propostas, projetos e financeiro em um só lugar. Acesse seu painel e acompanhe o próximo passo da sua empresa.</p></div>
        <div className="flex items-center gap-2 text-xs text-slate-400"><ShieldCheck className="h-4 w-4 text-violet" /> Acesso exclusivo ao administrador</div>
      </section>
      <section className="p-8 lg:p-12">
        <div className="mb-6 grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/5"><LockKeyhole className="h-5 w-5 text-violet" /></div>
        <h2 className="text-2xl font-semibold">Bem-vindo de volta</h2><p className="mb-8 mt-2 text-sm text-slate-400">Entre com seus dados para continuar.</p>
        <form onSubmit={submit} className="space-y-5">
          <div><label htmlFor="username" className="mb-2 block text-sm">Usuário</label><input id="username" name="username" className="field !py-3" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus required maxLength={80} placeholder="Seu usuário" value={username} onChange={e => setUsername(e.target.value)} /></div>
          <div><label htmlFor="password" className="mb-2 block text-sm">Senha</label><div className="relative"><input id="password" name="password" className="field !py-3 !pr-12" type={show ? 'text' : 'password'} autoComplete="current-password" required maxLength={128} placeholder="Sua senha" value={password} onChange={e => setPassword(e.target.value)} /><button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={show} className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 focus-visible:outline-2 focus-visible:outline-violet">{show ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></div>
          {error && <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-3 text-sm text-rose-300">{error}</p>}
          <button className="btn btn-primary w-full justify-center !py-3" disabled={busy || !username.trim() || !password}>{busy ? 'Entrando…' : 'Acessar dashboard'}{!busy && <ArrowRight size={17} />}</button>
        </form>
        <p className="mt-7 text-center text-xs leading-5 text-slate-500">Área privada da empresa.<br />Você pode alterar sua senha nas configurações.</p>
      </section>
    </div>
  </main>;
}
