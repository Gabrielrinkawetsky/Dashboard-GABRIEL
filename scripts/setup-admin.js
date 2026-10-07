import crypto from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { db } from '../server/db.js';
import { hashPassword } from '../server/auth.js';
if (await db.prepare('SELECT 1 FROM auth_users LIMIT 1').get()) {
  console.log('A conta já existe. Altere sua senha pelo painel.');
} else {
  const password = crypto.randomBytes(18).toString('base64url');
  await db.prepare('INSERT INTO auth_users (username,password_hash) VALUES (?,?)').run('gabriel', await hashPassword(password));
  if (existsSync('.env') && !process.env.VERCEL) writeFileSync('.env', readFileSync('.env','utf8').replace(/^ADMIN_PASSWORD=.*(?:\r?\n|$)/gm, ''));
  console.log('Usuário: gabriel\nSenha temporária: ' + password + '\nTroque a senha nas configurações.');
}
db.close();
