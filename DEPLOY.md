# Publicar na Vercel

O painel roda na Vercel como site estático (o build do Vite) + uma função (`api/index.js`, o mesmo servidor Express de sempre).
A Vercel não guarda arquivos entre execuções, então os dados ficam num banco **Turso** (SQLite na nuvem, mesmo SQL de antes).
Localmente nada muda: sem `TURSO_DATABASE_URL` o painel continua usando `data/app.db` (`npm run dev`).

## Por que o login "não funciona" na Vercel?
Quase sempre porque o banco ainda não foi conectado. Abra `https://SEU-ENDERECO.vercel.app/api/health`:

| Resposta | Significado |
|---|---|
| `503` + `"Banco de dados não configurado…"` | Falta conectar o Turso (passo 1) e fazer **Redeploy** |
| `503` + `"Não foi possível conectar ao banco…"` | `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` errados |
| `200` + `"adminCreated": false` | Banco OK, mas ainda não há conta: falta `ADMIN_INITIAL_PASSWORD` (passo 2) e **Redeploy** |
| `200` + `"adminCreated": true` | Tudo pronto: entre com o usuário `gabriel` |

(Os endereços `*.vercel.app` pedem login da Vercel antes: é a proteção padrão da plataforma, não do painel.)
A tela de login também mostra a mensagem de erro do servidor, por exemplo "Banco de dados não configurado".

## Variáveis de ambiente (Vercel → projeto → Settings → Environment Variables)
| Variável | De onde vem |
|---|---|
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Criadas sozinhas ao conectar o Turso ao projeto (Storage → Create → Turso) |
| `ADMIN_INITIAL_PASSWORD` | **Só na primeira vez.** Senha do administrador (15 a 128 caracteres), marcada como *Sensitive*. `ADMIN_PASSWORD` também é aceita (nome usado no `VERCEL.md` da outra branch) |
| `ADMIN_INITIAL_USERNAME` | Opcional. Usuário do administrador (padrão: `gabriel`) |
| `WEBHOOK_SECRET` | Segredo do webhook de pagamentos. Sem ele o webhook fica desligado (503); o resto do painel funciona |
| `TRUST_PROXY` | `1` — para o limite de tentativas de login usar o IP real do visitante |
| `APP_ORIGIN` | Opcional. Se definir, use a origem exata, ex.: `https://seu-painel.vercel.app` |

Nunca coloque esses valores no GitHub. Se alguma chave vazar, gere outra (Turso: novo token; Vercel: edite a variável e faça redeploy).

## Primeira vez (sem terminal)
1. **Banco:** projeto → *Storage* → *Create Database* → **Turso** → conectar ao projeto (*Production* e *Preview*).
2. **Administrador:** em *Environment Variables*, crie `ADMIN_INITIAL_PASSWORD` (*Sensitive*) com a senha que você quer usar.
3. **Redeploy:** *Deployments* → no último deploy, `⋯` → **Redeploy**. (Variáveis novas só valem para deploys novos.)
4. Confira `/api/health` (tabela acima) e entre com o usuário `gabriel` e a senha do passo 2.
5. **Depois de entrar:** em *Configurações → Senha de acesso* troque a senha e **apague `ADMIN_INITIAL_PASSWORD`** da Vercel.

Como funciona: ao iniciar, se o banco ainda **não tem nenhuma conta** e a variável existe, o servidor cria o administrador.
Se já existe qualquer conta, a variável é ignorada (nunca troca nem recria senha).

## Esqueci a senha (banco da nuvem)
No seu computador, com `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` no `.env` (copie de Vercel → Settings → Environment Variables):
`npm run auth:reset` (pede a nova senha sem mostrá-la; encerra todas as sessões).

Criar a conta direto pelo terminal, se preferir: `npm run auth:setup` (com as mesmas duas variáveis; a senha aparece só uma vez).

## Verificação antes de publicar
`npm run build` · `npm run test:auth` · `npm run test:security` · `npm run test:vercel` · `npm run test:vercel-nodb`

## Limites conhecidos
- Os testes locais não exercitam o Turso real: a primeira conexão com o banco da nuvem só se confirma depois do deploy (use `/api/health`).
- O limite de falhas do webhook (30/min) é por instância da função; o limite de login fica no banco e vale para todas.
- Dados do `data/app.db` local **não** vão sozinhos para o Turso (o banco da nuvem começa vazio).
- A proteção "Vercel Authentication" dos endereços `*.vercel.app` bloquearia um webhook de pagamento externo: use um domínio próprio ou ajuste a proteção ao conectar um provedor.
- `npm run dev` não reinicia a API sozinho ao editar `server/` (o `--watch` do Node entra em laço no Windows): reinicie o comando.
