import { useState, type FormEvent } from 'react';
import { api } from './api';
import { Card, Field, Title } from './ui';
export default function PasswordSettings() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setMessage('');
    if (next !== confirm) return setMessage('As novas senhas não coincidem.');
    setBusy(true);
    try { await api.changePassword(current, next); setCurrent(''); setNext(''); setConfirm(''); setMessage('Senha alterada. As outras sessões foram encerradas.'); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Não foi possível alterar a senha.'); }
    finally { setBusy(false); }
  };
  return <Card><Title>Senha de acesso</Title><p className="mb-4 text-sm text-slate-400">Troque a senha temporária por uma senha exclusiva de pelo menos 15 caracteres. As outras sessões serão encerradas.</p><form onSubmit={submit} className="space-y-3">
    <Field label="Senha atual"><input className="field" type="password" autoComplete="current-password" required maxLength={128} value={current} onChange={e => setCurrent(e.target.value)} /></Field>
    <Field label="Nova senha"><input className="field" type="password" autoComplete="new-password" required minLength={15} maxLength={128} value={next} onChange={e => setNext(e.target.value)} /></Field>
    <Field label="Confirme a nova senha"><input className="field" type="password" autoComplete="new-password" required minLength={15} maxLength={128} value={confirm} onChange={e => setConfirm(e.target.value)} /></Field>
    {message && <p role="status" className="text-sm text-violet">{message}</p>}
    <button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Alterar senha'}</button>
  </form></Card>;
}
