-- ============================================================================
-- SCRIPT DE LIMPEZA TRANSACIONAL: PRODUTOS E PEDIDOS (JANELA DE MANUTENÇÃO)
-- ATENÇÃO: NÃO EXECUTE ESTE SCRIPT SEM AUTORIZAÇÃO HUMANA E BACKUP CONFIRMADO!
-- ============================================================================

BEGIN;

-- 1. Verificação de segurança: verificar contagens prévias
DO $$
DECLARE
  v_prod_count INT;
  v_vendas_count INT;
BEGIN
  SELECT count(*) INTO v_prod_count FROM public.produtos;
  SELECT count(*) INTO v_vendas_count FROM public.vendas;
  RAISE NOTICE 'Iniciando limpeza. Contagem prévia: Produtos = %, Vendas = %', v_prod_count, v_vendas_count;
END $$;

-- 2. Excluir dependências filhas de Vendas (Pedidos)
DELETE FROM public.montagens_itens;
DELETE FROM public.montagens;
DELETE FROM public.entregas;
DELETE FROM public.devolucoes;
DELETE FROM public.solicitacoes_encomenda;
DELETE FROM public.assistencias_tecnicas;
DELETE FROM public.cobrancas_pix;
DELETE FROM public.whatsapp_message_queue;
DELETE FROM public.nps_links;

-- 3. Excluir a tabela pai de Vendas
DELETE FROM public.vendas;

-- 4. Excluir dependências filhas de Produtos
DELETE FROM public.estoque;
DELETE FROM public.produto_variantes;
DELETE FROM public.transferencias_estoque;
DELETE FROM public.movimentacoes_estoque;
DELETE FROM public.alertas_recompra;
DELETE FROM public.historico_precos;
DELETE FROM public.desconto_produto_excecoes;
DELETE FROM public.solicitacoes_cadastro_produto;

-- Se existir tabela de estoque legado por gtin, limpar registros
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'estoque_loja') THEN
    DELETE FROM public.estoque_loja;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'produtos_mestre') THEN
    DELETE FROM public.produtos_mestre;
  END IF;
END $$;

-- 5. Excluir a tabela pai de Produtos (tratando auto-referência parent_id se houvesse)
UPDATE public.produtos SET parent_id = NULL WHERE parent_id IS NOT NULL;
DELETE FROM public.produtos;

-- 6. Reiniciar sequências somente quando elas realmente existirem
DO $$
DECLARE
  seq_record RECORD;
BEGIN
  FOR seq_record IN (
    SELECT sequence_name 
    FROM information_schema.sequences 
    WHERE sequence_schema = 'public' 
      AND (
        sequence_name ILIKE '%produtos%' 
        OR sequence_name ILIKE '%vendas%' 
        OR sequence_name ILIKE '%entregas%'
        OR sequence_name ILIKE '%montagens%'
      )
  ) LOOP
    EXECUTE 'ALTER SEQUENCE public.' || quote_ident(seq_record.sequence_name) || ' RESTART WITH 1';
    RAISE NOTICE 'Sequência reiniciada: %', seq_record.sequence_name;
  END LOOP;
END $$;

-- 7. Validação de integridade pós-exclusão: garantir que estão vazias
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM public.produtos;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'FALHA DE SEGURANÇA: produtos não ficou vazio (restam % registros). Abortando!', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.vendas;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'FALHA DE SEGURANÇA: vendas não ficou vazio (restam % registros). Abortando!', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.produto_variantes;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'FALHA DE SEGURANÇA: produto_variantes não ficou vazio (restam % registros). Abortando!', v_count;
  END IF;

  RAISE NOTICE 'Limpeza validada com sucesso. Produtos e Vendas zerados com segurança.';
END $$;

COMMIT;
