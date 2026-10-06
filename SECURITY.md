# Segurança do painel

Complementa o `AUTH.md` (login, sessões, troca de senha). Este documento cobre o restante da API, o webhook,
a validação das gravações, o servidor de desenvolvimento e os segredos.

Verificação: `npm run build`, `npm run test:auth` (login/sessão) e `npm run test:security` (27 verificações abaixo).
Os testes rodam o servidor numa pasta temporária com banco próprio: não tocam em `data/` nem no `.env`.

## Superfície
- **Pública:** `POST /api/login`, `POST /api/logout`, `GET /api/session`, `POST /api/webhooks/payments` (este exige o segredo próprio) e os arquivos estáticos do build.
- **Exige sessão:** todo o resto de `/api` (verificado no servidor; esconder botão não é controle).
- Sistema de um único administrador e uma única empresa: não há isolamento entre usuários/empresas para testar (troca de IDs só alcança dados do próprio dono).

## Achados corrigidos
| # | Gravidade | Problema (evidência) | Correção |
|---|---|---|---|
| 1 | Alta | O logout pela tela **não revogava a sessão**: o frontend enviava `POST /api/logout` sem corpo, o servidor respondia 415 e a sessão seguia válida (reproduzido: 415 e 1 sessão ativa). Também quebrava toda exclusão (DELETE sem corpo) | `src/api.ts` envia JSON em toda gravação. Verificado no navegador: 1 sessão antes de "Sair", 0 depois |
| 2 | Alta | Webhook aceitava qualquer moeda, qualquer cliente, valores decimais e ids não-texto (`event_id` objeto virava `"[object Object]"` e **bloqueava eventos legítimos seguintes** como duplicados) | Valida moeda BRL, cliente da parcela, inteiro positivo em centavos, formato dos ids e data; valida **antes** de gravar o evento |
| 3 | Média | Estorno usava `LIKE` com o id do pagamento: `_`/`%` viravam curinga e misturavam estornos de pagamentos diferentes | Prefixo exato (`instr`); ids sem `:` |
| 4 | Média | Servidor de desenvolvimento (Vite) **entregava `data/app.db`** (e código do servidor) a quem acessasse a porta | `server.fs.deny` com padrões `**/`. API só escuta `127.0.0.1` por padrão (`HOST`) |
| 5 | Média | Proposta aprovada podia ter valor/cliente/serviço alterados por chamada direta, deixando projeto e parcelas inconsistentes (só a tela escondia o campo) | Servidor recusa (409) |
| 6 | Média | Aprovar com `parcelas: "abc"` retornava 200 e criava projeto **sem parcelas**; data inválida dava 500 | Validação estrita (inteiro 1–24, data real, entrada < valor) |
| 7 | Média | Sem validação de tipo/tamanho/intervalo: objeto em campo de texto dava 500, textos de 100 mil caracteres, valores de 10¹⁵, datas "lixo", enums livres, checklist inválido virava lista vazia (perda silenciosa) | `server/validate.js` + esquema por tabela; erros viram 400 e nada é gravado |
| 8 | Baixa | Erros vazavam stack/caminhos (JSON malformado respondia HTML com o stack) | Handler de erros genérico em JSON; 404 JSON para `/api` |
| 9 | Baixa | Sem limite para tentativas de adivinhar o segredo do webhook; corpo de até 1 MB | 30 falhas/min/IP → 429; corpo do webhook limitado a 64 KB |
| 10 | Baixa | A CSP bloqueava o Google Fonts em produção | Permite `fonts.googleapis.com`/`fonts.gstatic.com` (verificado: fonte carrega, 0 violações) |
| 11 | Baixa | Várias tentativas de login em paralelo podem esgotar memória (scrypt ~128 MB cada) | No máximo 2 hashes simultâneos. **Preventivo, não demonstrado** |

## Verificado sem achado
Toda rota privada recusa chamada sem sessão/cookie forjado · origem externa e corpo não-JSON recusados · sem CORS para origem externa ·
cookie `HttpOnly; SameSite=Strict` (+ `Secure` e HSTS em produção) · SQL injection (texto malicioso só vira texto; ids não numéricos não chegam ao banco) ·
10 aprovações simultâneas → 1 sucesso · 10 pagamentos simultâneos nunca passam do saldo · evento repetido e fora de ordem tratados ·
nenhum segredo versionado, nem no histórico do git, nem no build do navegador · sem `innerHTML`/`eval`/storage no frontend · `npm audit`: 0 vulnerabilidades.

## O que NÃO foi testado / depende de você
- **Assinatura do provedor:** não há provedor de cobrança conectado. O webhook usa um segredo estático. Ao escolher o provedor, implemente a verificação de assinatura **da documentação dele** e consulte o pagamento na API dele antes de confirmar. Não trate este webhook como "validado por provedor".
- **Produção:** exige HTTPS, `NODE_ENV=production`, `APP_ORIGIN` exato e, atrás de proxy reverso, `TRUST_PROXY` (senão o limite de tentativas enxerga só o IP do proxy). Redirecione HTTP→HTTPS na infraestrutura.
- **Bloqueio de login por usuário:** quem souber o nome de usuário pode forçar bloqueios de 15 minutos (limite por usuário). É a troca consciente do `AUTH.md`; a senha longa obrigatória protege contra adivinhação.
- **Backups, TLS, acesso ao computador/servidor:** fora do código.
- **Local:** o `.env` ainda tem `SESSION_SECRET`, que não é mais usado (pode apagar). Aquela senha antiga de administrador (`ADMIN_PASSWORD`) já foi removida pelo `auth:setup`.
- Não testado: recuperação de senha (não existe fluxo público por design), uploads (não existem), SSRF (não há requisições de saída), CSRF além da checagem de origem/`SameSite` (coberto por testes de origem, não por um navegador atacante real).
