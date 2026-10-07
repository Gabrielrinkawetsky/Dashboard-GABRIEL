import { db } from '../server/db.js';
import { changePassword } from '../server/auth.js';

// Lê a senha sem mostrá-la no terminal. Sem terminal interativo, lê a primeira linha do stdin.
const ask = label => new Promise((resolve, reject) => {
  const { stdin, stdout } = process;
  stdout.write(label);
  if (!stdin.isTTY) {
    let data = '';
    stdin.setEncoding('utf8');
    stdin.on('data', c => { data += c; });
    stdin.on('end', () => { stdout.write('\n'); resolve(data.split(/\r?\n/)[0]); });
    return;
  }
  let value = '';
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  const onData = chunk => {
    for (const ch of chunk) {
      if (ch === '\r' || ch === '\n') { done(); return resolve(value); }
      if (ch === '\u0003') { done(); return reject(new Error('Cancelado.')); }
      if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
      else if (ch >= ' ') value += ch;
    }
  };
  const done = () => { stdin.off('data', onData); stdin.setRawMode(false); stdin.pause(); stdout.write('\n'); };
  stdin.on('data', onData);
});

try {
  const user = await db.prepare('SELECT id, username FROM auth_users ORDER BY id LIMIT 1').get();
  if (!user) throw new Error('Nenhuma conta existe. Rode npm run auth:setup.');
  const password = await ask(`Nova senha para ${user.username}: `);
  if (password.length < 15 || password.length > 128) throw new Error('A nova senha deve ter entre 15 e 128 caracteres.');
  if (process.stdin.isTTY && await ask('Confirme a nova senha: ') !== password) throw new Error('As senhas não coincidem.');
  await changePassword(user.id, password);
  await db.prepare('DELETE FROM auth_attempts WHERE key=?').run(`user:${user.username}`);
  console.log(`Senha de ${user.username} redefinida. Todas as sessões foram encerradas.`);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  db.close();
}
