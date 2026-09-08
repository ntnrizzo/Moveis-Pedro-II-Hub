# Correções de segurança — 5 de setembro de 2026

Estado: alterações locais, sem implantação ou rotação confirmada no ambiente remoto.

Foram confirmados no código acesso anônimo a clientes, identidade fornecida pelo navegador, ausência de isolamento em operações privilegiadas e persistência compartilhada entre usuários/organizações. Isso representa risco de exposição de dados pessoais. Não foi verificado acesso indevido real, quantidade de pessoas afetadas ou conteúdo de logs de produção. Este registro não declara o incidente encerrado.

## Implementação local

- Identidade derivada de JWT validado e perfil ativo, usando o campo real `cargo`. Reset de senha verifica organização, inclusive no caminho alternativo de sincronização de IDs. Alterações de assinatura exigem administrador, incluindo troca de meio de pagamento que cancela a assinatura anterior.
- Aprovação/emissão fiscal, cadastro ACBR e cobranças verificam organização no servidor. Cobranças usam saldo e cliente persistidos, credenciais da própria organização e não compartilham cache OAuth entre organizações.
- Migrations novas substituem policies permissivas em clientes, vendas, perfis, permissões, tokens, configurações e tabelas financeiras. Portal possui leitura das próprias vendas. Triggers impedem escalada pelo próprio perfil e alteração direta de estado fiscal. `track_user_footstep` deriva o usuário da sessão; execução das versões antigas foi revogada.
- Bot exige JWT e perfil ativo, rejeita organização divergente e não aceita mais o segredo compartilhado. Rotas de alteração de entrega foram filtradas por organização; campos enviados para conclusão têm allowlist. Logs globais não são disponibilizados pela API.
- `registrar_venda_pdv` grava venda, estoque e encomendas na mesma transação. O ID da operação/venda pertence a usuário e organização; repetir uma operação confirmada retorna a venda sem debitar novamente. Erros de estoque revertem tudo. Itens de variante são validados contra produto, loja e organização; itens legados usam decremento condicional.
- `registrar_recebimento_oc` reúne OC, itens, histórico, estoque, preços e lançamento financeiro em uma transação. Verifica pertencimento de cada item e impede excesso de quantidade. A chave do recebimento permanece estável nas tentativas do modal. Numeração de OC usa contador por organização/ano, inicializado pelo maior número existente.
- Emissão fiscal reserva a venda e consome o token condicionalmente na mesma transação. Numeração fiscal foi versionada, sem fallback em JavaScript. Reservas não são liberadas automaticamente quando há resultado externo incerto, para evitar dupla emissão.
- Webhooks Stone PIX e Asaas registram o evento e processam o banco na mesma transação. Falha retorna erro para permitir nova tentativa; repetição não gera crédito duplicado. Stone valida conteúdo JWE/JWS, ambiente, conta, tipo, status e valor. Armazenamento do evento contém somente identificador/status.
- Carrinho e filas offline são separados por usuário/organização. Filas antigas sem proprietário não são migradas automaticamente. TenantContext ignora resultados antigos e não seleciona organização padrão em falhas. Scanner usa refs; hooks de pagamento invalidam respostas antigas.
- Restaurado o bloco removido de DevolucaoModal a partir de `4eaa6eb^`; acrescentada a consulta de metas faltante e removidas referências indefinidas a EMPRESA na impressão. Preservadas as alterações locais anteriores, incluindo a validação de GTIN, cujo fechamento de objeto faltante também foi corrigido.
- Auditoria do adaptador usa allowlist sem CPF, CNPJ, documentos, credenciais ou payloads aninhados. Logs de respostas completas dos provedores foram removidos dos fluxos alterados. Não houve exclusão de histórico de produção.

## Evidência local

- `npm test`: 127 testes aprovados, incluindo 29 testes de segurança nas três suítes novas.
- `npm run build`: aprovado; avisos de tamanho dos bundles e base Browserslist desatualizada. Lint direcionado e verificação sintática do bot aprovados.
- As novas migrations executaram em PostgreSQL descartável PGlite usando `tests/security/schema-fixture.sql`. Testados RLS, escalada de privilégios, isolamento, rollback, reexecução de venda/recebimento, estoque insuficiente, numeração e duplicação de webhook.
- PGlite executa consultas numa única instância; esse teste não substitui concorrência entre conexões independentes/duas abas em staging.
- A fixture é um contrato mínimo de teste, não uma cópia do schema de produção.
- `node tests/security/replay-migrations.mjs`: reprodução histórica falhou em `20241229_pagseguro_integration.sql`: `relation "vendas" does not exist`.

## Pendências de implantação e operação

1. O destino é o projeto Supabase de produção e a VPS Hostinger. Não há usuários ativos no momento. O roteiro operacional está em `docs/IMPLANTACAO_PRODUCAO_INICIAL.md`; nenhum destino remoto foi alterado nesta tarefa.
2. Revogar/rotacionar o valor antigo no provedor de hospedagem e remover `VITE_BOT_API_SECRET` dos ambientes de build. Publicar o frontend e o bot corrigidos e invalidar bundles antigos. Remover o uso no código não revoga uma credencial de um processo remoto ainda executando a versão antiga.
3. Para os crons, configurar `SUPABASE_ANON_KEY` e `BOT_SERVICE_ACCOUNTS` no servidor. O último é um objeto por UUID de organização com `email`/`password` de contas Supabase dedicadas, com perfil ativo e cargo `Bot`. O helper obtém JWT real e rejeita conta de outra organização; sem configuração, o cron falha fechado. Nunca publicar essa variável no Vite.
4. Para Stone, configurar `STONE_WEBHOOK_ENVIRONMENT` e `STONE_WEBHOOK_PRIVATE_KEY` em PKCS8, correspondente à chave registrada no provedor; manter `ASAAS_WEBHOOK_SECRET`. Validar exemplos reais assinados em sandbox antes de publicar. Referência: https://docs.openbank.stone.com.br/docs/guias/webhooks/ e https://docs.asaas.com/docs/about-webhooks.
5. Associar configurações Stone legadas à organização correta. Não foi atribuído um tenant padrão. Reconciliar estoques nulos/negativos, vínculos cruzados e números de OC duplicados antes das constraints; as migrations falham em vez de alterar os dados por suposição.
6. Aplicar banco antes das funções e frontend que dependem das RPCs, numa janela de implantação coordenada. Mesmo sem usuários ativos, testar o fluxo operacional com vendedor, financeiro, gerente, administrador e cliente do portal antes de liberar cadastros.
7. O proxy `/nfe-xml` foi bloqueado porque encaminhava credenciais fornecidas pelo navegador e não tinha vínculo confiável entre documento e organização. Requer implementação da obtenção de credencial fiscal no servidor. O webhook legado de `stone-payment-link` está bloqueado até receber validação e processamento compatíveis com eventos reais desse produto. O webhook Stone PIX possui o novo fluxo autenticado.
8. Reconciliar reservas de NF-e com o provedor antes de autorizar nova emissão após falha. Não apagar reservas automaticamente em timeout.

## Trabalho ainda não encerrado

- Item 25: as listagens legadas e os agregados dos relatórios ainda precisam migrar em conjunto para paginação/aggregação no servidor. Não foi aplicado um corte silencioso de dados, pois isso alteraria totais financeiros. O adaptador legado permanece paginando internamente até seu limite anterior.
- Item 27: obter baseline e `pg_dump --schema-only` de produção e staging, versionar a inicialização faltante e repetir todas as migrations. Não é possível afirmar equivalência usando a fixture local.
- Efeitos posteriores à transação principal do PDV — entrega, montagem, fidelidade e lançamentos disparados em segundo plano — ainda precisam de uma transação/outbox própria para recuperação integral após falhas. Venda/estoque/encomendas e reexecução offline estão cobertos; isso não equivale a atomicidade de todo o checkout.
- Exposição em logs históricos e eventual acesso real a dados pessoais exigem investigação no ambiente remoto. Preservar evidências e registrar responsável, data da implantação e confirmação da revogação antes de encerrar este registro.

## Verificação em staging

Executar a matriz solicitada: anônimo sem clientes; funcionário sem alteração de cargo; administrador A sem reset de B; venda de outra organização rejeitada em NF-e/cobranças; portal sem escrita; JWT ausente/expirado/inativo rejeitado no bot; webhook inválido ou duplicado sem crédito; duas conexões disputando último item; rollback por falha no segundo item; OC com item estrangeiro; recebimento repetido; numeração concorrente; troca de organização sem estado anterior; abertura das três telas corrigidas.
