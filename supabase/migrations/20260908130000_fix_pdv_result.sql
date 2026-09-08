BEGIN;
CREATE OR REPLACE FUNCTION public.registrar_venda_pdv(p_venda jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE org uuid; uid uuid:=auth.uid(); op_id uuid; op public.pdv_operations%ROWTYPE;
  item jsonb; qty integer; product public.produtos%ROWTYPE; store_id uuid; field text;
  variant_id uuid; changed integer; sale_result jsonb; request_data jsonb; created_sale_id bigint;
BEGIN
  SELECT organization_id INTO org FROM public.auth_context() WHERE ativo IS TRUE;
  IF org IS NULL OR uid IS NULL OR (p_venda->>'organization_id')::uuid IS DISTINCT FROM org THEN RAISE EXCEPTION 'Organização inválida'; END IF;
  op_id := (p_venda->>'id')::uuid;
  IF op_id IS NULL OR jsonb_typeof(p_venda->'itens') IS DISTINCT FROM 'array' OR jsonb_array_length(p_venda->'itens')=0 THEN RAISE EXCEPTION 'Venda/itens inválidos'; END IF;
  INSERT INTO public.pdv_operations(id,organization_id,user_id) VALUES(op_id,org,uid) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    SELECT * INTO STRICT op FROM public.pdv_operations WHERE id=op_id;
    IF op.organization_id<>org OR op.user_id<>uid THEN RAISE EXCEPTION 'Chave de operação de outra identidade'; END IF;
    IF op.result IS NOT NULL AND op.result <> '{}'::jsonb THEN RETURN op.result; END IF;
    SELECT to_jsonb(v) INTO STRICT sale_result FROM public.vendas v WHERE id=op.venda_id AND organization_id=org;
    RETURN sale_result;
  END IF;
  PERFORM 1 FROM public.clientes WHERE id=(p_venda->>'cliente_id')::bigint AND organization_id=org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente fora da organização'; END IF;
  SELECT id INTO STRICT store_id FROM public.lojas WHERE organization_id=org AND (id=nullif(p_venda->>'loja_id','')::uuid OR lower(trim(nome))=lower(trim(p_venda->>'loja'))) LIMIT 1;
  -- Reserve rows in a deterministic order; every item participates in this transaction.
  FOR item IN SELECT value FROM jsonb_array_elements(p_venda->'itens') ORDER BY value->>'produto_id',value->>'variante_id' LOOP
    IF (item->>'quantidade')::numeric IS DISTINCT FROM trunc((item->>'quantidade')::numeric)
      OR (item->>'quantidade')::numeric<=0 OR item->>'quantidade' IS NULL THEN RAISE EXCEPTION 'Quantidade inválida'; END IF;
    qty := (item->>'quantidade')::integer;
    SELECT * INTO STRICT product FROM public.produtos WHERE id=(item->>'produto_id')::bigint AND organization_id=org FOR UPDATE;
    IF coalesce((item->>'is_encomenda')::boolean,false) THEN
      IF product.fornecedor_id IS NULL THEN RAISE EXCEPTION 'Encomenda sem fornecedor'; END IF;
      CONTINUE;
    END IF;
    variant_id := nullif(item->>'variante_id','')::uuid;
    IF variant_id IS NOT NULL THEN
      PERFORM 1 FROM public.produto_variantes WHERE id=variant_id AND produto_id=product.id AND organization_id=org;
      IF NOT FOUND THEN RAISE EXCEPTION 'Variante fora do produto/organização'; END IF;
      PERFORM public.baixar_estoque(variant_id,org,qty,store_id);
    ELSE
      field := item->>'origem_estoque_campo';
      IF field IS NULL OR field !~ '^estoque_[a-z0-9_]+$' OR field IN ('estoque_minimo','estoque_ideal')
        OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.produtos'::regclass AND attname=field AND attnum>0 AND NOT attisdropped) THEN
        RAISE EXCEPTION 'Origem de estoque inválida';
      END IF;
      EXECUTE format('UPDATE public.produtos SET %I=%I-$1, quantidade_estoque=quantidade_estoque-$1 WHERE id=$2 AND organization_id=$3 AND %I >= $1 AND quantidade_estoque >= $1',field,field,field)
        USING qty,product.id,org;
      GET DIAGNOSTICS changed = ROW_COUNT;
      IF changed<>1 THEN RAISE EXCEPTION 'Estoque insuficiente'; END IF;
    END IF;
  END LOOP;
  request_data := (p_venda - 'id') || jsonb_build_object('organization_id',org,'nfe_aprovada',false,'nfe_emitida',false);
  IF (p_venda->>'id') ~ '^[0-9]+$' THEN
    request_data := request_data || jsonb_build_object('id', (p_venda->>'id')::bigint);
  END IF;
  sale_result := public._security_insert_json('public.vendas'::regclass,request_data);
  created_sale_id := (sale_result->>'id')::bigint;
  UPDATE public.pdv_operations SET venda_id=created_sale_id, result=sale_result WHERE id=op_id;
  FOR item IN SELECT value FROM jsonb_array_elements(p_venda->'itens') LOOP
    IF coalesce((item->>'is_encomenda')::boolean,false) THEN
      SELECT * INTO STRICT product FROM public.produtos WHERE id=(item->>'produto_id')::bigint AND organization_id=org;
      PERFORM public._security_insert_json('public.solicitacoes_encomenda'::regclass,jsonb_build_object(
        'organization_id',org,'venda_id',created_sale_id,'produto_id',product.id,'produto_nome',product.nome,
        'fornecedor_id',product.fornecedor_id,'quantidade',(item->>'quantidade')::integer,
        'cliente_nome',p_venda->>'cliente_nome','numero_pedido',p_venda->>'numero_pedido',
        'loja',p_venda->>'loja','loja_id',store_id,'vendedor_id',uid,'status','pendente'));
    END IF;
  END LOOP;
  RETURN sale_result;
END $$;
REVOKE ALL ON FUNCTION public.registrar_venda_pdv(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_venda_pdv(jsonb) TO authenticated;
COMMIT;
