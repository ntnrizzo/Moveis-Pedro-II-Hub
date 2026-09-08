# Runbook: Procedimento Seguro para Limpeza de Produtos e Pedidos (Janela de Manutenção)

> **ATENÇÃO / CRÍTICO**:  
> Este runbook foi desenhado para ser executado **exclusivamente durante uma janela de manutenção programada** e **mediante autorização humana explícita**.  
> **NÃO execute este procedimento sem backup prévio confirmado.**

---

## 1. Escopo Autorizado e Delimitação de Segurança

### Tabelas Autorizadas para Limpeza:
1. **Domínio de Vendas (Pedidos)** e dependências diretas de execução:
   - `montagens_itens`
   - `montagens`
   - `entregas`
   - `devolucoes`
   - `solicitacoes_encomenda`
   - `assistencias_tecnicas`
   - `cobrancas_pix` (registros de cobrança avulsa de pedidos)
   - `whatsapp_message_queue` (mensagens enfileiradas de pedidos)
   - `nps_links` (links de pesquisa pós-venda)
   - `vendas` (tabela pai de pedidos)

2. **Domínio de Produtos (Catálogo/Estoque)** e dependências diretas:
   - `estoque` (estoque por variante x loja)
   - `produto_variantes` (variantes de cor x tecido)
   - `transferencias_estoque`
   - `movimentacoes_estoque`
   - `alertas_recompra`
   - `historico_precos`
   - `desconto_produto_excecoes`
   - `solicitacoes_cadastro_produto`
   - `produtos` (tabela pai de catálogo)

### ⛔ TABELAS ESTRITAMENTE PROIBIDAS DE EXCLUSÃO:
- `clientes` (Clientes, contatos e endereços)
- `public_users` e `auth.users` (Colaboradores e credenciais de acesso)
- `organizations` e `organization_settings` (Empresas e configurações SaaS)
- `fornecedores` (Parceiros e fabricantes)
- `lojas` e `cargos` (Estrutura organizacional)
- `lancamentos_financeiros`, `categorias_financeiras` e `parcelas` (Dados contábeis e financeiros)
- `notas_fiscais_entrada`, `itens_nota_fiscal`, `notas_fiscais_emitidas`, `itens_nfe_emitida` (Dados fiscais legais)

> Se o script de limpeza detectar que tabelas financeiras ou fiscais contêm dependências que bloqueiam a exclusão (Foreign Keys sem CASCADE), a transação **será abortada imediatamente** (`ROLLBACK`). Nenhuma tabela não autorizada será tocada.

---

## 2. Passo a Passo Operacional

### Etapa 1: Ativação da Janela de Manutenção
1. Notifique os usuários sobre a parada programada.
2. Ative a flag de manutenção na aplicação ou bloqueie o tráfego no proxy/Vercel/Netlify.
3. Garanta que nenhum webhook ativo (ex: Asaas, PagSeguro, Bling, Omie) esteja realizando gravações em `produtos` ou `vendas`.

### Etapa 2: Backup Verificável (Pré-Reset)
Execute o backup lógico das tabelas envolvidas usando `pg_dump` com verificação de integridade:

```bash
# Exportar schema e dados das tabelas de Produtos e Pedidos
pg_dump "$DATABASE_URL" \
  --format=custom \
  --file="backup_pedidos_produtos_$(date +%Y%m%d_%H%M%S).dump" \
  --table=public.vendas \
  --table=public.entregas \
  --table=public.montagens \
  --table=public.montagens_itens \
  --table=public.devolucoes \
  --table=public.solicitacoes_encomenda \
  --table=public.assistencias_tecnicas \
  --table=public.cobrancas_pix \
  --table=public.whatsapp_message_queue \
  --table=public.nps_links \
  --table=public.produtos \
  --table=public.produto_variantes \
  --table=public.estoque \
  --table=public.transferencias_estoque \
  --table=public.movimentacoes_estoque \
  --table=public.alertas_recompra \
  --table=public.historico_precos \
  --table=public.desconto_produto_excecoes \
  --table=public.solicitacoes_cadastro_produto
```

Verifique se o dump foi criado e não está vazio:
```bash
pg_restore --list backup_pedidos_produtos_*.dump | head -n 30
```

### Etapa 3: Registro de Contagens Antes da Exclusão
Execute a seguinte query no Supabase SQL Editor para documentar o total de linhas antes do reset:

```sql
SELECT 'produtos' AS tabela, count(*) AS total FROM public.produtos
UNION ALL SELECT 'produto_variantes', count(*) FROM public.produto_variantes
UNION ALL SELECT 'estoque', count(*) FROM public.estoque
UNION ALL SELECT 'vendas', count(*) FROM public.vendas
UNION ALL SELECT 'entregas', count(*) FROM public.entregas
UNION ALL SELECT 'montagens', count(*) FROM public.montagens;
```

### Etapa 4: Execução do Script Transacional de Limpeza
Execute no Supabase SQL Editor o script disponibilizado em:
`sql/procedimento_limpeza_produtos_pedidos.sql`

O script:
- Abre uma transação (`BEGIN`).
- Verifica a ausência de violação de escopo.
- Exclui os dados na ordem rigorosa de filhas para pais.
- Reinicia sequências (quando existirem).
- Valida que as tabelas autorizadas ficaram com 0 registros.
- Comita a transação (`COMMIT`).

### Etapa 5: Aplicação das Novas Migrations
Aplique as migrações versionadas criadas para garantir o novo modelo:
1. `supabase/migrations/20260904180000_fix_produtos_sku_gtin_identity.sql`
2. `supabase/migrations/20260904180500_create_generic_product_sku.sql`

### Etapa 6: Criação dos Registros de Sistema Essenciais
Confirme que o produto genérico foi cadastrado com SKU:
```sql
SELECT id, organization_id, sku, codigo_barras, nome 
FROM public.produtos 
WHERE lower(trim(sku)) = 'prod-generico';
```
Deve retornar 1 registro por organização com `sku = 'PROD-GENERICO'` e `codigo_barras IS NULL`.

### Etapa 7: Smoke Tests
1. **Cadastro Manual**: Cadastrar um novo produto na UI. Verificar que o SKU foi gravado e que o código de barras pode ser nulo ou um GTIN válido.
2. **Reimportação**: Fazer upload do template CSV preenchido com SKU. Verificar que a reimportação do mesmo SKU atualiza o registro sem duplicar.
3. **Scanner**: Testar bipagem com GTIN válido. Confirmar que pesquisa estritamente `codigo_barras`.
4. **Busca Textual**: Pesquisar por SKU e por nome. Verificar que ambos são encontrados.

### Etapa 8: Liberação do Sistema
1. Desative o modo de manutenção.
2. Notifique os usuários sobre a conclusão bem-sucedida da manutenção.

---

## 3. Procedimento de Rollback / Restauração do Backup

Em caso de qualquer imprevisto crítico durante a janela de manutenção:

```bash
# 1. Conectar ao banco e restaurar dados do dump gerado na Etapa 2
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname="$DATABASE_URL" \
  backup_pedidos_produtos_<TIMESTAMP>.dump

# 2. Verificar a integridade das contagens restauradas
psql "$DATABASE_URL" -c "SELECT count(*) FROM public.produtos; SELECT count(*) FROM public.vendas;"
```
