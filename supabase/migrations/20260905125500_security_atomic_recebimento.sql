BEGIN;
ALTER TABLE public.estoque_loja ADD COLUMN IF NOT EXISTS produto_id bigint REFERENCES public.produtos(id);
ALTER TABLE public.estoque_loja ADD COLUMN IF NOT EXISTS loja_id uuid REFERENCES public.lojas(id);
ALTER TABLE public.estoque_loja ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.estoque_loja ADD COLUMN IF NOT EXISTS ultimo_recebimento timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS estoque_loja_produto_loja_unique ON public.estoque_loja(produto_id,loja_id);
CREATE TABLE IF NOT EXISTS public.oc_recebimento_operations (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NOT NULL,
  ordem_compra_id uuid NOT NULL REFERENCES public.compras_ordens(id), result jsonb NOT NULL DEFAULT '{}'
);
ALTER TABLE public.oc_recebimento_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.oc_recebimento_operations FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.stock_field(p_nome text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE
 WHEN lower(p_nome) LIKE '%cd%' OR lower(p_nome) LIKE '%centro de distribui%' THEN 'estoque_cd'
 WHEN lower(p_nome) LIKE '%mega%' THEN 'estoque_mostruario_mega_store'
 WHEN lower(p_nome)='centro' OR lower(p_nome) LIKE '%loja centro%' OR lower(p_nome) LIKE '%matriz%' THEN 'estoque_mostruario_centro'
 WHEN lower(p_nome) LIKE '%ponte branca%' THEN 'estoque_mostruario_ponte_branca'
 WHEN lower(p_nome) LIKE '%futura%' THEN 'estoque_mostruario_futura'
 ELSE 'estoque_' || regexp_replace(regexp_replace(lower(p_nome),'\s+','_','g'),'[^a-z0-9_-]','','g') END
$$;

CREATE OR REPLACE FUNCTION public.registrar_recebimento_oc(p_ordem_compra_id uuid,p_recebimento_id uuid,p_itens jsonb,p_chave_nfe text DEFAULT NULL,p_observacoes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; uid uuid:=auth.uid(); oc public.compras_ordens%ROWTYPE; item public.compras_oc_itens%ROWTYPE;
  incoming jsonb; qty integer; loja uuid; loja_nome text; campo text; historico_id uuid; product public.produtos%ROWTYPE;
  op public.oc_recebimento_operations%ROWTYPE; completo boolean; novo_status text; v_result jsonb; variant uuid; previous_price numeric;
BEGIN
 SELECT organization_id INTO org FROM public.auth_context() WHERE ativo IS TRUE;
 IF org IS NULL OR uid IS NULL OR p_recebimento_id IS NULL OR jsonb_typeof(p_itens) IS DISTINCT FROM 'array' OR jsonb_array_length(p_itens)=0 THEN RAISE EXCEPTION 'Requisição inválida'; END IF;
 INSERT INTO public.oc_recebimento_operations(id,organization_id,user_id,ordem_compra_id) VALUES(p_recebimento_id,org,uid,p_ordem_compra_id) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN
   SELECT * INTO STRICT op FROM public.oc_recebimento_operations WHERE id=p_recebimento_id;
   IF op.organization_id<>org OR op.user_id<>uid OR op.ordem_compra_id<>p_ordem_compra_id THEN RAISE EXCEPTION 'Operação de outra identidade/OC'; END IF;
   RETURN op.result;
 END IF;
 SELECT * INTO STRICT oc FROM public.compras_ordens WHERE id=p_ordem_compra_id AND organization_id=org FOR UPDATE;
 IF oc.status NOT IN ('Pedido Enviado','Parcialmente Recebido') THEN RAISE EXCEPTION 'Status da OC não permite recebimento'; END IF;
 IF (SELECT count(DISTINCT value->>'item_id') FROM jsonb_array_elements(p_itens))<>jsonb_array_length(p_itens) THEN RAISE EXCEPTION 'Itens duplicados'; END IF;
 loja:=nullif(oc.metadata->>'loja_id','')::uuid;
 IF loja IS NOT NULL THEN
   SELECT nome INTO STRICT loja_nome FROM public.lojas WHERE id=loja AND organization_id=org;
   campo:=public.stock_field(loja_nome);
 END IF;
 INSERT INTO public.compras_recebimentos_historico(organization_id,tenant_id,ordem_compra_id,numero_oc,numero_nfe,observacoes,recebido_por)
   VALUES(org,(jsonb_populate_record(NULL::public.compras_recebimentos_historico,jsonb_build_object('tenant_id',org))).tenant_id,oc.id,oc.numero_pedido,p_chave_nfe,p_observacoes,uid) RETURNING id INTO historico_id;
 FOR incoming IN SELECT value FROM jsonb_array_elements(p_itens) ORDER BY value->>'item_id' LOOP
   IF incoming->>'quantidade_recebida' IS NULL OR (incoming->>'quantidade_recebida')::numeric<=0
     OR (incoming->>'quantidade_recebida')::numeric<>trunc((incoming->>'quantidade_recebida')::numeric) THEN RAISE EXCEPTION 'Quantidade inválida'; END IF;
   qty:=(incoming->>'quantidade_recebida')::integer;
   SELECT * INTO STRICT item FROM public.compras_oc_itens WHERE id=(incoming->>'item_id')::uuid
     AND ordem_compra_id=oc.id AND organization_id=org FOR UPDATE;
   IF coalesce(item.quantidade_recebida,0)+qty>item.quantidade_pedida THEN RAISE EXCEPTION 'Quantidade excede o pedido'; END IF;
   SELECT * INTO STRICT product FROM public.produtos WHERE id=item.produto_id AND organization_id=org FOR UPDATE;
   UPDATE public.compras_oc_itens SET quantidade_recebida=coalesce(quantidade_recebida,0)+qty,
     status_recebimento=CASE WHEN coalesce(quantidade_recebida,0)+qty=quantidade_pedida THEN 'Completo' ELSE 'Parcial' END WHERE id=item.id;
   INSERT INTO public.compras_recebimentos_itens(recebimento_id,oc_item_id,quantidade_recebida,preco_unitario,observacao_item)
     VALUES(historico_id,item.id,qty,item.preco_unitario,NULL);
   variant:=nullif(to_jsonb(item)->>'variante_id','')::uuid;
   IF variant IS NOT NULL THEN
     IF loja IS NULL THEN RAISE EXCEPTION 'Recebimento de variante exige loja'; END IF;
     PERFORM 1 FROM public.produto_variantes WHERE id=variant AND produto_id=product.id AND organization_id=org;
     IF NOT FOUND THEN RAISE EXCEPTION 'Variante divergente'; END IF;
     INSERT INTO public.estoque(organization_id,variante_id,loja_id,quantidade) VALUES(org,variant,loja,qty)
       ON CONFLICT(variante_id,loja_id) DO UPDATE SET quantidade=public.estoque.quantidade+excluded.quantidade;
   ELSIF loja IS NOT NULL THEN
     INSERT INTO public.estoque_loja(organization_id,tenant_id,produto_id,loja_id,quantidade,ultimo_recebimento)
       VALUES(org,org::text,product.id,loja,qty,now())
       ON CONFLICT(produto_id,loja_id) DO UPDATE SET quantidade=coalesce(public.estoque_loja.quantidade,0)+excluded.quantidade,ultimo_recebimento=now();
     IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.produtos'::regclass AND attname=campo AND attnum>0 AND NOT attisdropped) THEN RAISE EXCEPTION 'Loja sem campo de estoque'; END IF;
     EXECUTE format('UPDATE public.produtos SET %I=coalesce(%I,0)+$1,quantidade_estoque=coalesce(quantidade_estoque,0)+$1 WHERE id=$2',campo,campo) USING qty,product.id;
   ELSE
     UPDATE public.produtos SET quantidade_estoque=coalesce(quantidade_estoque,0)+qty WHERE id=product.id;
   END IF;
   INSERT INTO public.movimentacoes_estoque(organization_id,produto_id,evento_tipo,modulo_origem,quantidade,referencia_id,referencia_numero,usuario_id)
     VALUES(org,product.id,'recebimento','compras',qty,oc.id,oc.numero_pedido,uid);
   SELECT preco_novo INTO previous_price FROM public.historico_precos WHERE organization_id=org AND produto_id=product.id AND fornecedor_id=oc.fornecedor_id ORDER BY created_at DESC LIMIT 1;
   previous_price:=coalesce(previous_price,item.preco_unitario);
   INSERT INTO public.historico_precos(organization_id,produto_id,produto_nome,fornecedor_id,fornecedor_nome,ordem_compra_id,numero_oc,tipo,motivo,preco_antigo,preco_novo,delta_percentual)
     VALUES(org,product.id,product.nome,oc.fornecedor_id,oc.fornecedor_nome,oc.id,oc.numero_pedido,'compra','recebimento_oc',previous_price,item.preco_unitario,CASE WHEN previous_price>0 THEN round((item.preco_unitario-previous_price)/previous_price*100,2) ELSE 0 END);
 END LOOP;
 SELECT bool_and(coalesce(quantidade_recebida,0)>=quantidade_pedida) INTO completo FROM public.compras_oc_itens WHERE ordem_compra_id=oc.id AND organization_id=org;
 novo_status:=CASE WHEN completo THEN 'Recebido' ELSE 'Parcialmente Recebido' END;
 UPDATE public.compras_ordens SET status=novo_status,updated_at=now() WHERE id=oc.id;
 UPDATE public.solicitacoes_encomenda SET status=CASE WHEN completo THEN 'recebida' ELSE 'recebida_parcial' END,observacoes=p_observacoes WHERE ordem_id=oc.id AND organization_id=org;
 IF completo THEN
   -- Serialized by the OC row; use its stable origin rather than fuzzy amount/text matching.
   IF NOT EXISTS(SELECT 1 FROM public.lancamentos_financeiros WHERE organization_id=org AND origem='OC#'||oc.numero_pedido AND deleted_at IS NULL) THEN
     INSERT INTO public.lancamentos_financeiros(organization_id,tipo,descricao,valor,data_vencimento,data_lancamento,status,origem,numero_pedido,fornecedor_nome)
       VALUES(org,'DESPESA','Compra OC #'||oc.numero_pedido,oc.valor_total,oc.data_pedido::date+coalesce(oc.prazo_pagamento,30)::integer,current_date,'Pendente','OC#'||oc.numero_pedido,oc.numero_pedido,oc.fornecedor_nome);
   END IF;
 END IF;
 v_result:=jsonb_build_object('success',true,'novoStatus',novo_status,'message',jsonb_array_length(p_itens)||' item(ns) recebido(s). Status: '||novo_status);
 UPDATE public.oc_recebimento_operations SET result=v_result WHERE id=p_recebimento_id;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.registrar_recebimento_oc(uuid,uuid,jsonb,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_recebimento_oc(uuid,uuid,jsonb,text,text) TO authenticated;
COMMIT;
