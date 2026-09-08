# Implantação inicial em produção

O projeto não tem usuários ativos. A implantação pode introduzir as novas políticas e RPCs sem migração de sessões de clientes, mas continua exigindo uma cópia de segurança e uma ordem coordenada entre banco, Edge Functions, frontend e bot.

## Preparação no Supabase

1. No painel do projeto, confirme que o backup/PITR está disponível e registre o horário da implantação.
2. Gere uma nova chave `service_role`. A chave que já esteve em `scripts/limpar_produtos.mjs` deve ser revogada; remover o arquivo não a invalida.
3. Remova `VITE_BOT_API_SECRET` de todas as variáveis de build e configuração. Ele não é mais aceito pelo código.
4. Cadastre os segredos das Edge Functions: `STONE_WEBHOOK_PRIVATE_KEY`, `STONE_WEBHOOK_ENVIRONMENT` e `ASAAS_WEBHOOK_SECRET`. Use a chave privada PKCS8 correspondente à chave pública cadastrada na Stone.
5. Aplique as migrations pendentes pela Supabase CLI vinculada ao projeto ou pelo SQL Editor, preservando a ordem do nome dos arquivos. Não pule as migrations `20260905*`: as funções e o frontend dependem delas.
6. Publique as funções alteradas: `admin-actions`, `aprovar-nfe`, `emitir-nfe`, `registrar-empresa-acbr`, `criar-assinatura`, `stone-pix-create`, `pagseguro-checkout`, `stone-payment-link`, `stone-pix-webhook` e `asaas-webhook`, junto de `_shared`.

## Preparação na VPS Hostinger

No arquivo `.env` do bot, mantenha a nova `SUPABASE_SERVICE_KEY` apenas no servidor e acrescente:

```env
SUPABASE_ANON_KEY=<anon-key-do-projeto>
TRACKING_TOKEN_SECRET=<segredo-aleatorio-longo>
BOT_SERVICE_ACCOUNTS=<json-de-contas-tecnicas-por-organizacao>
```

Cada conta em `BOT_SERVICE_ACCOUNTS` deve ser uma conta Supabase dedicada, ativa, com `cargo = Bot`, pertencente à organização indicada. A credencial não deve aparecer no Vite, Git ou logs. Os crons falham fechados se a configuração estiver ausente.

Faça a atualização com uma versão identificável e valide antes de retirar a anterior:

```bash
git fetch origin
git checkout <commit-validado>
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=100
```

O `docker-compose.prod.yml` expõe a aplicação na porta 80. Não publique a porta 3001 diretamente se o proxy reverso já atende HTTPS.

## Verificação após publicar

- Requisição sem JWT não retorna clientes nem acessa o bot.
- Funcionário não modifica o próprio cargo; administrador de uma organização não reseta usuário de outra.
- Vendedor não cancela assinatura.
- Venda de outra organização é rejeitada por emissão/aprovação de NF-e e por cobrança.
- Repetir um webhook não cria crédito duplicado; assinatura Stone inválida não é aceita.
- Duas baixas concorrentes não deixam estoque negativo.
- Portal lê somente as próprias vendas e não consegue alterá-las ou excluí-las.
- A troca de organização no navegador não reaproveita carrinho ou fila offline de outro usuário.

Registre a data, o commit, a pessoa que aplicou as migrations e a confirmação de rotação da chave. Isso completa a evidência interna de diligência relacionada a LGPD.
