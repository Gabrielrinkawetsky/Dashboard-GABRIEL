Autenticação do dashboard
========================

O acesso privado exige usuário e senha. Não existe cadastro público. A conta inicial é criada uma única vez com `npm run auth:setup`; a senha aleatória aparece apenas na execução desse comando. O banco guarda somente um hash scrypt com salt aleatório (N=131072, r=8, p=1), nunca a senha original. O antigo ADMIN_PASSWORD é removido do .env ao provisionar a conta.

Troque a senha em Configurações → Senha de acesso. A nova senha deve ter entre 15 e 128 caracteres. A troca exige a senha atual e encerra todas as sessões anteriores. Sair revoga a sessão no servidor. As sessões têm duração máxima de oito horas e somente o hash do token aleatório é armazenado no banco.

As rotas /api exigem sessão válida, exceto login, logout, consulta de sessão e webhook. O webhook continua protegido pelo seu segredo próprio. Tentativas de autenticação são limitadas por IP e usuário em janelas de 15 minutos, persistidas no SQLite. Requisições de gravação pelo navegador exigem JSON e são verificadas quanto à origem.

Para desenvolvimento, execute `npm run dev` e acesse http://localhost:5180. Para produção, execute o build e sirva com NODE_ENV=production, HTTPS e APP_ORIGIN definido para a origem exata do painel (por exemplo, https://painel.suaempresa.com). A configuração de produção ativa cookies Secure e HSTS. A infraestrutura deve redirecionar HTTP para HTTPS. Não publique .env, data/ ou backups. Em produção, somente o build e a API devem ser expostos; não use o servidor de desenvolvimento Vite.

Esta implementação usa um único administrador e banco SQLite persistente. A recuperação de acesso requer manutenção pelo operador do servidor; não há fluxo público de recuperação por e-mail. A proteção de hospedagem, backups, domínio, TLS e acesso ao computador depende da configuração operacional. Esta mudança não é uma auditoria de todo o dashboard.

Verificação: `npm run build` e `npm run test:auth`. Os testes usam um banco temporário isolado e verificam APIs privadas, credenciais inválidas, origem externa, logout, expiração, alteração de senha, revogação de sessões e limite de tentativas.

Referências técnicas: [scrypt no Node.js](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback) e [gerenciamento de sessões da OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).
