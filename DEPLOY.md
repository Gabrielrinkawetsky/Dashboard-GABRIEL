# Publicar na Vercel

O painel roda na Vercel como site estático (o build do Vite) + uma função (`api/index.js`, o mesmo servidor Express de sempre).
A Vercel não guarda arquivos entre execuções, então os dados ficam num banco **Turso** (SQLite na nuvem, mesmo SQL de antes).
Localmente nada muda: sem `TURSO_DATABASE_URL` o painel continua usando `data/app.db` (`npm run dev`).

## Variáveis de ambiente (Vercel → projeto → Settings → Environment Variables)
| Variável | De onde vem |
|---|---|
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Criadas sozinhas ao conectar o Turso ao projeto (Storage → Create → Turso) |
| `WEBHOOK_SECRET` | Segredo do webhook de pagamentos. Obrigatório em produção (o servidor recusa subir sem ele) |
| `TRUST_PROXY` | `1` — para o limite de tentativas de login usar o IP real do visitante |
| `ADMIN_INITIAL_PASSWORD` | **Só na primeira vez.** Senha do administrador (15 a 128 caracteres). Marque como *Sensitive* |
| `ADMIN_INITIAL_USERNAME` | Opcional. Usuário do administrador (padrão: `gabriel`) |
| `APP_ORIGIN` | Opcional. Se definir, use a origem exata, ex.: `https://seu-painel.vercel.app` |

Nunca coloque esses valores no GitHub. Se alguma chave vazar, gere outra (Turso: novo token; Vercel: edite a variável e faça redeploy).

## Primeira vez (sem terminal)
1. **Banco:** projeto → *Storage* → *Create Database* → **Turso** → conectar ao projeto (*Production* e *Preview*).
2. **Administrador:** em *Environment Variables*, crie `ADMIN_INITIAL_PASSWORD` com a senha que você quer usar (*Sensitive*).
3. **Redeploy:** *Deployments* → no último deploy, `⋯` → **Redeploy**. (Variáveis novas só valem para deploys novos.)
4. Abra o endereço do projeto e entre com o usuário `gabriel` e a senha do passo 2.
5. **Depois de entrar:** em *Configurações → Senha de acesso* troque a senha e **apague `ADMIN_INITIAL_PASSWORD`** da Vercel.

Como funciona: ao iniciar, se o banco ainda **não tem nenhuma conta** e `ADMIN_INITIAL_PASSWORD` existe, o servidor cria o administrador.
Se já existe qualquer conta, a variável é ignorada (nunca troca nem recria senha), então deixá-la lá não é perigoso, mas não é necessária.

Alternativa pelo terminal (cria a conta direto no banco da nuvem; a senha aparece só no seu terminal):
```
# PowerShell, na pasta do projeto — copie os dois valores de Vercel → Settings → Environment Variables
$env:TURSO_DATABASE_URL="libsql://..."; $env:TURSO_AUTH_TOKEN="..."; npm run auth:setup
```

## Verificação antes de publicar
`npm run build` · `npm run test:auth` · `npm run test:security` · `npm run test:vercel`

## Limites conhecidos
- O teste local não exercita o Turso real: a primeira conexão com o banco da nuvem só pode ser validada depois do deploy.
- O limite de falhas do webhook (30/min) é por instância da função; o limite de login fica no banco e vale para todas.
- Dados do `data/app.db` local **não** vão sozinhos para o Turso (o banco da nuvem começa vazio).
- Os endereços `*.vercel.app` vêm com a proteção "Vercel Authentication" ligada (quem abre precisa estar logado na Vercel). Um webhook de pagamento externo seria bloqueado por ela: use um domínio próprio ou ajuste a proteção quando conectar um provedor.
