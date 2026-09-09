# Correções de acesso ao Financeiro — 09/09/2026

## Causa e correção

A migration de 08/09 corrigia UPDATE, mas INSERT continuava exclusivo do
Administrador. A organização padrão dos lançamentos também era um UUID fixo.
O erro 42501 foi reproduzido em PostgreSQL descartável antes da implementação.

Foram aplicadas e verificadas no Supabase de produção:

- `20260909120000_fix_financial_creation.sql`: criação por Financeiro ativo e
  organização padrão derivada do usuário; criação de categorias pelo Financeiro.
- `20260909121000_financial_capabilities.sql`: resolvedor de permissões financeiras,
  policies por operação, colunas faltantes usadas pelo editor de cargos e RPC de
  exclusão transacional de recorrências.

Não foram reescritas migrations anteriores nem alterados lançamentos históricos.
O teste remoto `tests/security/verify-financial-production.sql` confirmou as
permissões de um perfil Financeiro ativo e o default de organização, sem criar
lançamentos. Ele verifica o servidor; não substitui a validação com login real.

## Regras

- Administrador ativo: operações financeiras completas na própria organização.
- Financeiro ativo: consulta, criação, edição, baixa, recorrências e novas categorias.
- Gerente/Gerente Geral: consulta por padrão.
- Outros cargos: somente concessões financeiras expressamente configuradas pelo administrador.
- Inativos, anônimos e clientes do portal: sem acesso a lançamentos internos.
- Excluir lançamentos e editar/excluir categorias: exclusivamente Administrador.
- Aprovar pagamentos de OC: capacidade separada `approve_payment_oc`, sem concessão automática ao Financeiro.

O resolvedor combina cargo principal e cargos adicionais, aplica concessões por
cargo da própria organização e personalizações individuais. Negações prevalecem
independentemente da ordem dos cargos; `inherit:false` remove permissões herdadas.
Gerenciar implica consultar; negar consulta também impede gerenciamento.
O Administrador mantém sua exceção. O frontend usa o resultado do servidor,
recarrega ao recuperar foco e a cada 60 segundos, e bloqueia escrita em falhas.
A RLS verifica cada operação, independentemente desse intervalo.

O código conserva dados digitados quando o salvamento falha, cancela geração
agendada de recorrências após troca de identidade e separa os caches financeiros
por usuário/organização. DELETE sem registros retornados não gera sucesso ou
auditoria de exclusão. Encerrar/excluir recorrências agora ocorre numa transação.

## Validação e publicação

- `npm run test:security`: inclui regressões de INSERT, UPDATE, DELETE, múltiplos
  cargos, negações, isolamento por organização e rollback de recorrência.
- `npx vitest run src/lib/__tests__/financialCapabilities.test.js src/lib/__tests__/financialDelete.test.js src/lib/__tests__/financeiroRecorrencia.test.js`:
  respostas obsoletas, troca de identidade, indisponibilidade e falso sucesso em DELETE.
- `npm run build`: verificação de imports e compilação das telas.

Depois do push, atualizar a VPS com `git pull --ff-only origin main` e
`docker compose -f docker-compose.prod.yml up -d --build`. Conferir healthcheck e
fazer login com Financeiro para criar, editar e baixar um lançamento de validação
autorizado. Não há sessão SSH ou sessão do sistema no navegador disponível neste
ambiente; essa etapa deve ser confirmada na VPS. A alteração local preexistente
do Docker Compose foi preservada e não faz parte deste commit.

## Problemas relacionados que ainda exigem trabalho separado

As policies de `parcelas` e `compras_contas_pagar` ainda restringem escrita ao
Administrador. Não foram abertas genericamente: concessões dependem dos contratos
dos fluxos de compras e recebimento, e não apenas de acesso ao Financeiro.

Conferência de caixa e recebimento de pagamentos em Vendas/DashboardGerente fazem
gravações financeiras pelo navegador; Gerente não deve receber permissão genérica
para lançar despesas para contornar isso. Esses fluxos precisam de operações
específicas no servidor, que validem a venda, valores e cargo.

A aprovação de OC tem etapas separadas e um caminho em comprasService que registra
falha financeira apenas como aviso. A proteção de seu botão não substitui uma RPC
atômica com validação de `approve_payment_oc`. A geração de recorrências ainda usa
verificação de duplicatas no cliente, sem unicidade concorrente no banco.

Esses pontos foram identificados; esta correção não encerra a auditoria geral nem
afirma que todos os fluxos financeiros/compras estão transacionais.
