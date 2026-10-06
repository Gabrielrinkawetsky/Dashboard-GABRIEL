# Publicar na Vercel

O painel roda na Vercel como site estático (o build do Vite) + uma função (`api/index.js`, o mesmo servidor Express de sempre).
A Vercel não guarda arquivos entre execuções, então os dados ficam num banco **Turso** (SQLite na nuvem, mesmo SQL de antes).
Localmente nada muda: sem `TURSO_DATABASE_URL` o painel continua usando `data/app.db` (`npm run dev`).

## Variáveis de ambiente (Vercel → Settings → Environment Variables)
| Variável | De onde vem |
|---|---|
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Criadas sozinhas ao conectar o Turso ao projeto (Storage → Create → Turso) |
| `WEBHOOK_SECRET` | Segredo do webhook de pagamentos. Obrigatório em produção (o servidor recusa subir sem ele) |
| `TRUST_PROXY` | `1` — para o limite de tentativas de login usar o IP real do visitante |
| `APP_ORIGIN` | Opcional. Se definir, use a origem exata, ex.: `https://seu-painel.vercel.app` |

Nunca coloque esses valores no GitHub. Se alguma chave vazar, gere outra (Turso: novo token; Vercel: edite a variável e faça redeploy).

## Primeira vez
1. Conecte o Turso ao projeto na Vercel (cria o banco e as duas variáveis).
2. Crie a conta de administrador no banco da nuvem, **do seu computador** (a senha aparece só uma vez, no seu terminal):
   ```
   # PowerShell, na pasta do projeto — copie os dois valores em Vercel → Settings → Environment Variables
   $env:TURSO_DATABASE_URL="libsql://..."; $env:TURSO_AUTH_TOKEN="..."; npm run auth:setup
   ```
   Troque a senha em Configurações → Senha de acesso.
3. Faça o deploy (push na branch de produção) e acesse o endereço do projeto.

## Verificação antes de publicar
`npm run build` · `npm run test:auth` · `npm run test:security` · `npm run test:vercel`

## Limites conhecidos
- O teste local não exercita o Turso real: a primeira conexão com o banco da nuvem só pode ser validada depois do deploy.
- O limite de falhas do webhook (30/min) é por instância da função; o limite de login fica no banco e vale para todas.
- Dados do `data/app.db` local **não** vão sozinhos para o Turso (o banco da nuvem começa vazio).
