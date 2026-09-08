-- ============================================================================
-- Migration: Cadastrar produto genérico com SKU correto e codigo_barras nulo
-- Data: 2026-09-04
-- ============================================================================

DO $$
DECLARE
  v_org RECORD;
  v_count INT := 0;
BEGIN
  -- Percorrer todas as organizações cadastradas (incluindo a default se existir)
  FOR v_org IN (SELECT id FROM public.organizations) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.produtos 
      WHERE organization_id = v_org.id 
        AND lower(trim(sku)) = 'prod-generico'
    ) THEN
      INSERT INTO public.produtos (
        organization_id,
        sku,
        codigo_barras,
        nome,
        descricao,
        preco_venda,
        preco_custo,
        quantidade_estoque,
        ativo,
        categoria
      ) VALUES (
        v_org.id,
        'PROD-GENERICO',
        NULL,
        'Produto Genérico (Solicitação)',
        'Produto de sistema para cadastros sob demanda. NÃO EXCLUIR.',
        0.00,
        0.00,
        999999,
        true,
        'Sistema'
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;

  -- Se não havia nenhuma organização na tabela, insere para a organização default do sistema
  IF v_count = 0 AND NOT EXISTS (SELECT 1 FROM public.produtos WHERE lower(trim(sku)) = 'prod-generico') THEN
    INSERT INTO public.produtos (
      organization_id,
      sku,
      codigo_barras,
      nome,
      descricao,
      preco_venda,
      preco_custo,
      quantidade_estoque,
      ativo,
      categoria
    ) VALUES (
      '00000000-0000-0000-0000-000000000001'::uuid,
      'PROD-GENERICO',
      NULL,
      'Produto Genérico (Solicitação)',
      'Produto de sistema para cadastros sob demanda. NÃO EXCLUIR.',
      0.00,
      0.00,
      999999,
      true,
      'Sistema'
    );
  END IF;
END $$;
