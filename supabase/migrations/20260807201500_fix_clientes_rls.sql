-- ============================================================================
-- FIX: Ajustar RLS da tabela clientes para permitir atualização pelo Portal do Cliente
-- ============================================================================
-- PROBLEMA: A política restritiva clientes_isolated bloqueava o portal do cliente
-- (onde o usuário autenticado é o próprio cliente, e não um funcionário em public_users).
-- Isso causava o erro "new row violates row-level security policy for table clientes".
--
-- SOLUÇÃO: Aplicar a política padrão com RLS ativo permitindo operações para
-- usuários autenticados (conforme regra do projeto) e leitura anônima para fluxos de login/cadastro.
-- ============================================================================

ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clientes_isolated" ON public.clientes;
DROP POLICY IF EXISTS clientes_isolated ON public.clientes;
DROP POLICY IF EXISTS "Usuarios aprovados veem clientes" ON public.clientes;
DROP POLICY IF EXISTS "Cargos especificos criam clientes" ON public.clientes;
DROP POLICY IF EXISTS "Gerentes editam clientes" ON public.clientes;
DROP POLICY IF EXISTS "Vendedor edita proprios clientes" ON public.clientes;
DROP POLICY IF EXISTS "Gerentes excluem clientes" ON public.clientes;
DROP POLICY IF EXISTS "Service role bypass clientes" ON public.clientes;
DROP POLICY IF EXISTS all_clientes ON public.clientes;

-- Política padrão conforme regra de tabela do projeto
CREATE POLICY all_clientes ON public.clientes 
FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Permitir leitura anônima para busca/identificação no portal antes do login
DROP POLICY IF EXISTS select_clientes_anon ON public.clientes;
-- Acesso anônimo removido: identificação pública não pode expor clientes.

-- Atualizar a função _rebuild_all_isolated_policies para remover 'clientes'
-- da lista de tabelas internas restritas por organização de funcionário
CREATE OR REPLACE FUNCTION public._rebuild_all_isolated_policies()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    tbl text;
    policy_name text;
    tables_to_fix text[] := ARRAY[
      'public_users', 'vendas', 'produtos', 'fornecedores',
      'orcamentos', 'lojas', 'cargos', 'devolucoes', 'entregas',
      'montagens', 'assistencias_tecnicas',
      'parcelas', 'lancamentos_financeiros', 'categorias_financeiras',
      'configuracao_taxas', 'configuracao_comissoes',
      'colaboradores', 'folhas_pagamento', 'ferias', 'licencas',
      'vagas', 'candidatos', 'avaliacoes_desempenho', 'documentos_rh',
      'ponto_eletronico',
      'vendedores', 'campanhas', 'cupons', 'valores_montagem',
      'montadores', 'montagens_itens',
      'transferencias_estoque', 'inventarios', 'alertas_recompra',
      'movimentacoes_estoque', 'solicitacoes_reposicao',
      'notas_fiscais_entrada', 'itens_nota_fiscal',
      'notas_fiscais_emitidas', 'itens_nfe_emitida',
      'pedidos_compra', 'itens_pedido_compra', 'compras_contas_pagar',
      'solicitacoes_preco', 'solicitacoes_encomenda',
      'compras_ordens', 'compras_oc_itens', 'compras_centro_custos',
      'compras_workflows', 'compras_recebimentos_historico',
      'solicitacoes_cadastro_produto', 'promocoes_fornecedor',
      'historico_precos',
      'caminhoes', 'notificacoes', 'mensagens_chat', 'audit_logs',
      'role_permissions', 'cobrancas_pix', 'whatsapp_message_queue',
      'metas_vendas', 'regras_comissao', 'comissoes_historico',
      'comissoes_fechamento_mensal', 'niveis_comissao',
      'niveis_comissao_faixas', 'tokens_gerenciais',
      'desconto_produto_excecoes', 'log_uso_tokens',
      'nps_links', 'nps_avaliacoes',
      'payment_provider_configs', 'payment_transactions',
      'cores', 'tecidos', 'produto_variantes', 'estoque',
      'conferencias_caixa', 'configuracoes_sistema', 'configuracao_prazos'
    ];
BEGIN
    FOREACH tbl IN ARRAY tables_to_fix LOOP
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
          policy_name := tbl || '_isolated';
          
          EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, tbl);
          
          EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR ALL USING (
              auth.jwt() ->> ''role'' = ''service_role'' 
              OR organization_id = (SELECT public.get_user_org_id())
            ) WITH CHECK (
              auth.jwt() ->> ''role'' = ''service_role'' 
              OR organization_id = (SELECT public.get_user_org_id())
            )',
            policy_name, tbl
          );
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Erro em % (ignorado): %', tbl, SQLERRM;
      END;
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
