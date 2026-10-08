Integração com o Asaas
======================

O painel cria cobranças no Asaas a partir das parcelas e registra sozinho os pagamentos e estornos.

Configurar
----------
1. No Asaas: Integrações → Chaves de API → gerar chave. Chave de sandbox (testes) começa com `$aact_hmlg_`; de produção, com `$aact_prod_`. O painel escolhe o ambiente pela chave (ou defina `ASAAS_ENV=sandbox|production`).
2. Na Vercel (Settings → Environment Variables) ou no `.env` local:
   - `ASAAS_API_KEY`: a chave do passo 1.
   - `ASAAS_WEBHOOK_TOKEN`: um texto aleatório de 32 a 255 caracteres, sem espaços (não use a chave de API).
3. Faça um novo deploy.
4. No Asaas: Integrações → Webhooks → novo webhook:
   - URL: `https://SEU-PAINEL/api/webhooks/asaas` (aparece em Configurações no painel, para copiar).
   - Token de autenticação: o mesmo `ASAAS_WEBHOOK_TOKEN`.
   - Eventos: os de Cobrança (pagamento confirmado, recebido, estornado, excluído).
   - Tipo de envio: sequencial.

Usar
----
- Cadastre o CPF ou CNPJ do cliente (Clientes → editar). O Asaas exige.
- Em Financeiro, na parcela, clique em “Cobrar no Asaas”. O painel cria o cliente no Asaas (uma vez só) e uma cobrança do saldo em aberto. O cliente escolhe PIX, boleto ou cartão. O link de pagamento é copiado e fica nos botões da parcela.
- Quando o cliente paga, o Asaas avisa o painel e o pagamento aparece em Movimentações como “Integração (asaas)”.
- O botão de atualizar busca o status no Asaas na hora (útil se o webhook ainda não estiver configurado).
- O botão X cancela a cobrança no Asaas enquanto não foi paga.

Como funciona e limites
-----------------------
- O webhook só é aceito com o token certo (`asaas-access-token`). O corpo do evento só diz qual cobrança mudou: valor e status são buscados na API do Asaas.
- Eventos repetidos, fora de ordem ou CONFIRMED seguido de RECEIVED não duplicam pagamentos.
- O valor registrado é o que o cliente pagou de fato (inclui juros e multa, se houver).
- Eventos que não interessam (outras cobranças, assinaturas) respondem 200 para não interromper a fila do Asaas. Se o Asaas ou o banco estiver fora do ar, o painel responde 500 e o Asaas tenta de novo. Se a fila for interrompida, reative em Integrações → Webhooks.
- Estorno parcial não é registrado automaticamente: lance a diferença manualmente.
- Cobranças criadas direto no Asaas, fora do painel, são ignoradas.
- Se o CPF/CNPJ ou nome do cliente mudar depois da primeira cobrança, atualize também no Asaas.
- Teste: `npm run test:asaas` (usa um Asaas falso local; não acessa sua conta).
