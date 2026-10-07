Publicar na Vercel
==================

Na Vercel não existe disco permanente, então o banco fica no Turso (SQLite na nuvem, plano gratuito). Localmente, sem as variáveis do Turso, o painel continua usando `data/app.db`.

1. Crie uma conta em https://turso.tech e um banco (por exemplo, `dashboard`).
2. No painel do Turso, copie a **URL** do banco (`libsql://...turso.io`) e gere um **token** de acesso.
3. Na Vercel, abra o projeto → Settings → Environment Variables e cadastre, no ambiente Production:
   - `TURSO_DATABASE_URL`: a URL do passo 2
   - `TURSO_AUTH_TOKEN`: o token do passo 2
   - `ADMIN_PASSWORD`: a senha da primeira conta (15 a 128 caracteres)
   - `APP_ORIGIN`: o endereço exato do painel, por exemplo `https://dashboard-gabriel.vercel.app`
   - `WEBHOOK_SECRET`: opcional; um texto aleatório longo. Sem ele, o webhook de pagamentos fica desligado.
4. Faça um novo deploy (Deployments → Redeploy).
5. Entre com o usuário `gabriel` e a senha de `ADMIN_PASSWORD`.
6. Apague `ADMIN_PASSWORD` da Vercel. Ela só cria a conta quando o banco ainda não tem nenhuma; nunca altera uma conta existente.

Trocar a senha depois: Configurações → Senha de acesso. Se perder a senha, rode no seu computador, com as duas variáveis do Turso no `.env`:
`npm run auth:reset`.

Como funciona: `vercel.json` publica o build do Vite (`dist`) e envia `/api/*` para `api/index.js`, que reaproveita o mesmo servidor Express.
