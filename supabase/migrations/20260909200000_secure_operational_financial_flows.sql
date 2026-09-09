BEGIN;

-- Compatibility columns already used by the application. Some older tenants
-- were created before these fields were versioned in a migration.
ALTER TABLE public.lancamentos_financeiros
  ADD COLUMN IF NOT EXISTS origem text,
  ADD COLUMN IF NOT EXISTS fornecedor_nome text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE public.entregas
  ADD COLUMN IF NOT EXISTS pagamento_confirmado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pagamento_pendente_motivo text,
  ADD COLUMN IF NOT EXISTS data_pagamento_confirmado timestamptz;

ALTER TABLE public.vendas
  ADD COLUMN IF NOT EXISTS pagamento_entrega_confirmado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pagamento_entrega_observacao text;

-- One permission resolver is shared by RLS-facing RPCs.  It mirrors the
-- frontend role matrix, then applies tenant role overrides and user overrides.
CREATE OR REPLACE FUNCTION public.has_app_permission(p_permission text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  profile public.public_users%ROWTYPE;
  roles text[] := '{}';
  allowed text[] := '{}';
  denied text[] := '{}';
  role_name text;
  entry record;
  custom jsonb;
BEGIN
  SELECT * INTO profile FROM public.public_users WHERE id = auth.uid();
  IF NOT FOUND OR profile.ativo IS DISTINCT FROM TRUE OR profile.organization_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT coalesce(array_agg(DISTINCT btrim(r)), '{}'::text[]) INTO roles
  FROM unnest(coalesce(profile.cargos, '{}'::text[]) || ARRAY[profile.cargo]) r
  WHERE r IS NOT NULL AND btrim(r) <> '';

  IF 'Administrador' = ANY(roles) THEN
    allowed := ARRAY['*'];
  ELSE
    FOREACH role_name IN ARRAY roles LOOP
      allowed := allowed || CASE role_name
        WHEN 'Gerente' THEN ARRAY['view_dashboard','view_dashboard_gerente','view_vendas','manage_vendas','cancel_vendas','view_estoque','view_clientes','manage_clientes','view_entregas','manage_entregas','view_assistencia','manage_assistencia','view_financeiro','view_relatorios','view_rh','view_orcamentos','create_vendas','view_produtos','manage_produtos','view_catalogo','view_montagem','view_marketing','view_compras','create_oc','manage_compras','manage_cost_prices','approve_oc','view_fornecedores','view_nfe']
        WHEN 'Gerente Geral' THEN ARRAY['view_dashboard','view_dashboard_gerente','view_vendas','manage_vendas','cancel_vendas','view_estoque','manage_estoque','view_clientes','manage_clientes','view_entregas','manage_entregas','view_assistencia','manage_assistencia','view_financeiro','view_relatorios','view_rh','view_orcamentos','create_vendas','view_produtos','manage_produtos','view_catalogo','view_montagem','view_marketing','view_compras','create_oc','manage_compras','manage_cost_prices','send_oc','receive_oc','view_fornecedores','manage_bulk_price_adjustment','view_nfe','view_cliente_access_analytics']
        WHEN 'Vendedor' THEN ARRAY['view_dashboard','view_vendas','create_vendas','view_produtos','view_clientes','create_clientes','view_orcamentos','create_orcamentos','view_catalogo','view_nfe']
        WHEN 'Estoque' THEN ARRAY['view_estoque','manage_estoque','view_entregas','manage_entregas','view_montagem','view_produtos','view_compras','receive_oc','view_fornecedores']
        WHEN 'Financeiro' THEN ARRAY['view_financeiro','manage_financeiro','view_vendas','view_clientes','view_compras','approve_oc','view_fornecedores','view_nfe']
        WHEN 'Logística' THEN ARRAY['view_entregas','manage_entregas','view_montagem','manage_montagem','view_clientes']
        WHEN 'RH' THEN ARRAY['view_rh','manage_rh']
        WHEN 'Montador' THEN ARRAY['view_montagem','manage_montagem']
        WHEN 'Entregador' THEN ARRAY['view_entregas','view_mobile_entregador']
        WHEN 'Montador Externo' THEN ARRAY['view_mobile_montador']
        WHEN 'Comprador' THEN ARRAY['view_compras','create_oc','manage_compras','manage_cost_prices','send_oc','view_produtos','manage_produtos','view_fornecedores']
        ELSE '{}'::text[]
      END;
    END LOOP;
  END IF;

  FOR entry IN
    SELECT permissions, denied_permissions FROM public.role_permissions
    WHERE organization_id = profile.organization_id AND cargo = ANY(roles)
  LOOP
    IF jsonb_typeof(entry.permissions) = 'array' THEN
      allowed := allowed || ARRAY(SELECT jsonb_array_elements_text(entry.permissions));
    END IF;
    denied := denied || coalesce(entry.denied_permissions, '{}'::text[]);
  END LOOP;

  custom := coalesce(profile.custom_permissions, '{}'::jsonb);
  IF custom->'inherit' = 'false'::jsonb THEN allowed := '{}'; END IF;
  IF jsonb_typeof(custom->'allowed') = 'array' THEN
    allowed := allowed || ARRAY(SELECT jsonb_array_elements_text(custom->'allowed'));
  END IF;
  IF jsonb_typeof(custom->'denied') = 'array' THEN
    denied := denied || ARRAY(SELECT jsonb_array_elements_text(custom->'denied'));
  END IF;

  RETURN (p_permission = ANY(allowed) OR '*' = ANY(allowed))
    AND NOT (p_permission = ANY(denied) OR '*' = ANY(denied));
END;
$$;
REVOKE ALL ON FUNCTION public.has_app_permission(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_app_permission(text) TO authenticated;

ALTER TABLE public.lancamentos_financeiros
  ADD COLUMN IF NOT EXISTS operation_key text,
  ADD COLUMN IF NOT EXISTS operation_source_type text,
  ADD COLUMN IF NOT EXISTS operation_source_id text,
  ADD COLUMN IF NOT EXISTS created_by uuid;

CREATE UNIQUE INDEX IF NOT EXISTS lancamentos_financeiros_operation_unique
  ON public.lancamentos_financeiros(organization_id, operation_key)
  WHERE operation_key IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.operational_financial_operations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL,
  operation_type text NOT NULL,
  source_id text NOT NULL,
  result jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, operation_type, source_id, id)
);
ALTER TABLE public.operational_financial_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operational_financial_operations FROM anon, authenticated;

-- Extend the existing private JSON insert helper to the records inserted by
-- the new transactional RPCs. Public callers still cannot execute it.
CREATE OR REPLACE FUNCTION public._security_insert_json(p_table regclass,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE cols text; vals text; result jsonb;
BEGIN
  IF p_table NOT IN (
    'public.vendas'::regclass,
    'public.solicitacoes_encomenda'::regclass,
    'public.lancamentos_financeiros'::regclass,
    'public.entregas'::regclass,
    'public.montagens_itens'::regclass
  ) THEN RAISE EXCEPTION 'Tabela inválida'; END IF;
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN RAISE EXCEPTION 'Payload inválido'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE NOT EXISTS(
    SELECT 1 FROM pg_attribute a WHERE a.attrelid=p_table AND a.attname=k AND a.attnum>0 AND NOT a.attisdropped)) THEN
    RAISE EXCEPTION 'Campo não reconhecido no contrato';
  END IF;
  SELECT string_agg(format('%I',k),',' ORDER BY k),string_agg(format('(jsonb_populate_record(NULL::%s,$1)).%I',p_table,k),',' ORDER BY k)
    INTO cols,vals FROM jsonb_object_keys(p_data) k;
  EXECUTE format('WITH inserted AS (INSERT INTO %s (%s) SELECT %s RETURNING *) SELECT to_jsonb(inserted) FROM inserted',p_table,cols,vals)
    INTO result USING p_data;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public._security_insert_json(regclass,jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._insert_operational_financial_entry(
  p_org uuid, p_user uuid, p_source_type text, p_source_id text,
  p_operation_key text, p_entry jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE payload jsonb; result jsonb;
BEGIN
  IF p_operation_key IS NULL OR btrim(p_operation_key) = '' THEN RAISE EXCEPTION 'Chave de idempotência obrigatória'; END IF;
  SELECT to_jsonb(l) INTO result FROM public.lancamentos_financeiros l
    WHERE l.organization_id=p_org AND l.operation_key=p_operation_key AND l.deleted_at IS NULL;
  IF result IS NOT NULL THEN RETURN result; END IF;

  payload := (coalesce(p_entry,'{}'::jsonb)
    - ARRAY['id','organization_id','operation_key','operation_source_type','operation_source_id','created_by','deleted_at','data_pagamento','devolucao_id','origem_id'])
    || jsonb_build_object(
      'organization_id',p_org,'operation_key',p_operation_key,
      'operation_source_type',p_source_type,'operation_source_id',p_source_id,'created_by',p_user
    );
  IF p_entry ? 'data_pagamento' AND NOT (p_entry ? 'data_lancamento_real') THEN
    payload := payload || jsonb_build_object('data_lancamento_real',p_entry->'data_pagamento');
  END IF;
  BEGIN
    result := public._security_insert_json('public.lancamentos_financeiros'::regclass,payload);
  EXCEPTION WHEN unique_violation THEN
    SELECT to_jsonb(l) INTO STRICT result FROM public.lancamentos_financeiros l
      WHERE l.organization_id=p_org AND l.operation_key=p_operation_key AND l.deleted_at IS NULL;
  END;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public._insert_operational_financial_entry(uuid,uuid,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_operational_financial_entry(
  p_source_type text, p_source_id text, p_operation_key text, p_entry jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE org uuid; uid uuid:=auth.uid(); allowed boolean:=false; assigned uuid;
BEGIN
  SELECT organization_id INTO org FROM public.auth_context() WHERE ativo IS TRUE;
  IF org IS NULL OR uid IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado ou inativo' USING ERRCODE='42501'; END IF;

  CASE p_source_type
    WHEN 'assistencia' THEN
      allowed:=public.has_app_permission('manage_assistencia');
      PERFORM 1 FROM public.assistencias_tecnicas WHERE id=p_source_id::uuid AND organization_id=org;
    WHEN 'devolucao' THEN
      allowed:=public.has_app_permission('approve_devolucoes') OR public.has_app_permission('manage_vendas');
      PERFORM 1 FROM public.devolucoes WHERE id=p_source_id::bigint AND organization_id=org;
    WHEN 'montagem' THEN
      allowed:=public.has_app_permission('manage_montagem') OR public.has_app_permission('manage_financeiro');
      PERFORM 1 FROM public.montagens_itens WHERE id=p_source_id::bigint AND organization_id=org;
    WHEN 'folha' THEN
      allowed:=public.has_app_permission('manage_rh');
      PERFORM 1 FROM public.folhas_pagamento WHERE id=p_source_id::uuid AND organization_id=org;
    WHEN 'comissao' THEN
      allowed:=public.has_app_permission('manage_financeiro');
      PERFORM 1 FROM public.comissoes_fechamento_mensal WHERE id=p_source_id::uuid AND organization_id=org;
    WHEN 'nota_entrada' THEN
      allowed:=public.has_app_permission('manage_compras') OR public.has_app_permission('manage_estoque');
      PERFORM 1 FROM public.notas_fiscais_entrada WHERE id=p_source_id::uuid AND organization_id=org;
    WHEN 'pedido_compra_legado' THEN
      allowed:=public.has_app_permission('receive_oc') OR public.has_app_permission('manage_compras');
      PERFORM 1 FROM public.pedidos_compra WHERE id=p_source_id::uuid AND organization_id=org;
    WHEN 'venda' THEN
      allowed:=public.has_app_permission('create_vendas') OR public.has_app_permission('manage_vendas');
      PERFORM 1 FROM public.vendas WHERE id=p_source_id::bigint AND organization_id=org;
    WHEN 'venda_pagamento' THEN
      allowed:=public.has_app_permission('manage_vendas') OR public.has_app_permission('manage_financeiro');
      PERFORM 1 FROM public.vendas WHERE id=p_source_id::bigint AND organization_id=org;
    WHEN 'entrega' THEN
      SELECT entregador_id INTO assigned FROM public.entregas WHERE id=p_source_id::bigint AND organization_id=org;
      allowed:=public.has_app_permission('manage_entregas')
        OR (public.has_app_permission('view_mobile_entregador') AND assigned=uid);
    ELSE
      RAISE EXCEPTION 'Origem financeira não permitida';
  END CASE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Origem não encontrada nesta organização'; END IF;
  IF NOT allowed THEN RAISE EXCEPTION 'Cargo sem permissão para este fluxo' USING ERRCODE='42501'; END IF;
  RETURN public._insert_operational_financial_entry(org,uid,p_source_type,p_source_id,p_operation_key,p_entry);
END;
$$;
REVOKE ALL ON FUNCTION public.create_operational_financial_entry(text,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_operational_financial_entry(text,text,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.registrar_pagamento_venda(
  p_venda_id bigint, p_pagamentos jsonb, p_data_pagamento date,
  p_observacao text, p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE org uuid; uid uuid:=auth.uid(); sale public.vendas%ROWTYPE; op public.operational_financial_operations%ROWTYPE;
  payment jsonb; total_received numeric:=0; total_sale numeric; paid_before numeric; remaining_before numeric;
  paid_after numeric; remaining_after numeric; new_payments jsonb:='[]'::jsonb; payment_method text; result jsonb;
BEGIN
  SELECT organization_id INTO org FROM public.auth_context() WHERE ativo IS TRUE;
  IF org IS NULL OR uid IS NULL OR NOT (public.has_app_permission('manage_vendas') OR public.has_app_permission('manage_financeiro')) THEN
    RAISE EXCEPTION 'Cargo sem permissão para registrar pagamento de venda' USING ERRCODE='42501';
  END IF;
  IF p_operation_id IS NULL OR jsonb_typeof(p_pagamentos) <> 'array' OR jsonb_array_length(p_pagamentos)=0 THEN RAISE EXCEPTION 'Pagamento inválido'; END IF;
  INSERT INTO public.operational_financial_operations(id,organization_id,user_id,operation_type,source_id)
    VALUES(p_operation_id,org,uid,'venda_pagamento',p_venda_id::text) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    SELECT * INTO STRICT op FROM public.operational_financial_operations WHERE id=p_operation_id;
    IF op.organization_id<>org OR op.operation_type<>'venda_pagamento' OR op.source_id<>p_venda_id::text THEN RAISE EXCEPTION 'Operação pertence a outro contexto'; END IF;
    RETURN op.result;
  END IF;
  SELECT * INTO STRICT sale FROM public.vendas WHERE id=p_venda_id AND organization_id=org FOR UPDATE;
  IF lower(coalesce(sale.status,'')) LIKE 'cancel%' THEN RAISE EXCEPTION 'Venda cancelada não recebe pagamento'; END IF;
  FOR payment IN SELECT value FROM jsonb_array_elements(p_pagamentos) LOOP
    IF coalesce((payment->>'valor')::numeric,0)<=0 THEN RAISE EXCEPTION 'Valor de pagamento inválido'; END IF;
    total_received:=total_received+(payment->>'valor')::numeric;
    new_payments:=new_payments || jsonb_build_array(jsonb_build_object(
      'forma_pagamento',coalesce(nullif(btrim(payment->>'forma_pagamento'),''),'Não informado'),
      'valor',(payment->>'valor')::numeric,'parcelas',greatest(coalesce((payment->>'parcelas')::integer,1),1),
      'data_pagamento',coalesce(p_data_pagamento,current_date)
    ));
  END LOOP;
  total_sale:=greatest(coalesce(sale.valor_total,sale.total,0),0);
  paid_before:=greatest(coalesce(sale.valor_pago,0),0);
  remaining_before:=greatest(coalesce(sale.valor_restante,total_sale-paid_before),0);
  IF total_received>remaining_before+0.01 THEN RAISE EXCEPTION 'Valor recebido supera o saldo da venda'; END IF;
  paid_after:=least(total_sale,paid_before+total_received);
  remaining_after:=greatest(total_sale-paid_after,0);
  payment_method:=CASE WHEN jsonb_array_length(new_payments)=1 THEN new_payments->0->>'forma_pagamento' ELSE 'Múltiplos' END;
  UPDATE public.vendas SET
    valor_pago=paid_after,valor_restante=remaining_after,
    pagamentos=coalesce(pagamentos,'[]'::jsonb)||new_payments,
    forma_pagamento=payment_method,
    status=CASE WHEN remaining_after<=0.01 THEN 'Pago' ELSE 'Pagamento Pendente' END,
    status_pagamento=CASE WHEN remaining_after<=0.01 THEN 'PAGO' ELSE 'PENDENTE' END,
    data_pagamento=coalesce(p_data_pagamento,current_date)::timestamptz,
    observacoes=concat_ws(E'\n',nullif(observacoes,''),nullif(p_observacao,''))
    WHERE id=sale.id;
  UPDATE public.lancamentos_financeiros SET
    pago=(remaining_after<=0.01),
    status=CASE WHEN remaining_after<=0.01 THEN 'Pago' ELSE status END,
    data_lancamento_real=CASE WHEN remaining_after<=0.01 THEN coalesce(p_data_pagamento,current_date) ELSE data_lancamento_real END,
    forma_pagamento=payment_method
    WHERE organization_id=org AND venda_id=sale.id AND lower(tipo) IN ('receita','entrada') AND deleted_at IS NULL;
  result:=jsonb_build_object('venda_id',sale.id,'valorRecebido',total_received,'valorPago',paid_after,'valorRestante',remaining_after,'pagamentoQuitado',remaining_after<=0.01,'pagamentos',new_payments,'formaPagamento',payment_method);
  UPDATE public.operational_financial_operations SET result=result WHERE id=p_operation_id;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.registrar_pagamento_venda(bigint,jsonb,date,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_pagamento_venda(bigint,jsonb,date,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.registrar_pagamento_entrega(
  p_entrega_id bigint, p_pagamento_status text, p_pagamentos jsonb,
  p_motivo_pendente text, p_comprovante_url text, p_data_pagamento timestamptz,
  p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE org uuid; uid uuid:=auth.uid(); delivery public.entregas%ROWTYPE; sale public.vendas%ROWTYPE;
  op public.operational_financial_operations%ROWTYPE; payment jsonb; normalized jsonb:='[]'::jsonb;
  total_received numeric:=0; total_sale numeric; paid_before numeric; remaining_before numeric;
  paid_after numeric; remaining_after numeric; payment_method text; paid boolean; result jsonb;
BEGIN
  SELECT organization_id INTO org FROM public.auth_context() WHERE ativo IS TRUE;
  IF org IS NULL OR uid IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado ou inativo' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT delivery FROM public.entregas WHERE id=p_entrega_id AND organization_id=org FOR UPDATE;
  IF NOT (public.has_app_permission('manage_entregas') OR (public.has_app_permission('view_mobile_entregador') AND delivery.entregador_id=uid)) THEN
    RAISE EXCEPTION 'Cargo sem permissão para confirmar pagamento da entrega' USING ERRCODE='42501';
  END IF;
  paid:=lower(coalesce(p_pagamento_status,''))='pago';
  IF p_operation_id IS NULL OR (paid AND (jsonb_typeof(p_pagamentos)<>'array' OR jsonb_array_length(p_pagamentos)=0)) THEN RAISE EXCEPTION 'Pagamento inválido'; END IF;
  INSERT INTO public.operational_financial_operations(id,organization_id,user_id,operation_type,source_id)
    VALUES(p_operation_id,org,uid,'entrega_pagamento',p_entrega_id::text) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN SELECT * INTO STRICT op FROM public.operational_financial_operations WHERE id=p_operation_id; RETURN op.result; END IF;
  IF delivery.venda_id IS NOT NULL THEN SELECT * INTO STRICT sale FROM public.vendas WHERE id=delivery.venda_id AND organization_id=org FOR UPDATE; END IF;
  IF paid THEN
    FOR payment IN SELECT value FROM jsonb_array_elements(p_pagamentos) LOOP
      IF coalesce((payment->>'valor')::numeric,0)<=0 THEN RAISE EXCEPTION 'Valor de pagamento inválido'; END IF;
      total_received:=total_received+(payment->>'valor')::numeric;
      normalized:=normalized||jsonb_build_array(jsonb_build_object('forma_pagamento',coalesce(nullif(btrim(payment->>'forma_pagamento'),''),'Não informado'),'valor',(payment->>'valor')::numeric,'parcelas',greatest(coalesce((payment->>'parcelas')::integer,1),1),'data_pagamento',coalesce(p_data_pagamento,now())));
    END LOOP;
    total_sale:=greatest(coalesce(sale.valor_total,sale.total,delivery.valor_a_receber,0),0);
    paid_before:=greatest(coalesce(sale.valor_pago,0),0);
    remaining_before:=greatest(coalesce(sale.valor_restante,total_sale-paid_before),0);
    IF total_received>remaining_before+0.01 THEN RAISE EXCEPTION 'Valor recebido supera o saldo da venda'; END IF;
    paid_after:=least(total_sale,paid_before+total_received); remaining_after:=greatest(total_sale-paid_after,0);
    payment_method:=CASE WHEN jsonb_array_length(normalized)=1 THEN normalized->0->>'forma_pagamento' ELSE 'Múltiplos' END;
  ELSE
    paid_after:=coalesce(sale.valor_pago,0); remaining_after:=coalesce(sale.valor_restante,greatest(coalesce(sale.valor_total,sale.total,0)-paid_after,0));
  END IF;
  UPDATE public.entregas SET
    pagamento_confirmado=paid AND remaining_after<=0.01,
    pagamento_pendente_motivo=CASE WHEN paid AND remaining_after<=0.01 THEN NULL WHEN paid THEN 'Pagamento parcial recebido. Saldo restante: R$ '||to_char(remaining_after,'FM999999990D00') ELSE coalesce(nullif(p_motivo_pendente,''),'Pagamento não realizado na entrega') END,
    data_pagamento_confirmado=coalesce(p_data_pagamento,now()),
    comprovante_pagamento_url=coalesce(nullif(p_comprovante_url,''),comprovante_pagamento_url),
    forma_pagamento_entrega=CASE WHEN paid THEN payment_method ELSE forma_pagamento_entrega END
    WHERE id=delivery.id;
  IF delivery.venda_id IS NOT NULL THEN
    UPDATE public.vendas SET
      pagamento_entrega_confirmado=paid AND remaining_after<=0.01,
      pagamento_entrega_observacao=CASE WHEN paid AND remaining_after<=0.01 THEN NULL WHEN paid THEN 'Pagamento parcial recebido na entrega' ELSE coalesce(nullif(p_motivo_pendente,''),'Pagamento pendente na entrega') END,
      valor_pago=CASE WHEN paid THEN paid_after ELSE valor_pago END,
      valor_restante=CASE WHEN paid THEN remaining_after ELSE valor_restante END,
      pagamentos=CASE WHEN paid THEN coalesce(pagamentos,'[]'::jsonb)||normalized ELSE pagamentos END,
      forma_pagamento=CASE WHEN paid THEN payment_method ELSE forma_pagamento END,
      status=CASE WHEN paid AND remaining_after<=0.01 THEN 'Pago' ELSE 'Pagamento Pendente' END,
      status_pagamento=CASE WHEN paid AND remaining_after<=0.01 THEN 'PAGO' ELSE 'PENDENTE' END,
      data_pagamento=CASE WHEN paid THEN coalesce(p_data_pagamento,now()) ELSE data_pagamento END
      WHERE id=sale.id;
    IF paid AND remaining_after<=0.01 THEN
      UPDATE public.lancamentos_financeiros SET status='Pago',pago=true,data_lancamento_real=coalesce(p_data_pagamento,now())::date,forma_pagamento=payment_method
        WHERE organization_id=org AND venda_id=sale.id AND lower(tipo) IN ('receita','entrada') AND deleted_at IS NULL;
    END IF;
  END IF;
  result:=jsonb_build_object('pagamentoQuitado',paid AND remaining_after<=0.01,'valorRecebido',total_received,'pagamentos',normalized,'entregaUpdates',jsonb_build_object('pagamento_confirmado',paid AND remaining_after<=0.01,'forma_pagamento_entrega',payment_method),'vendaUpdates',jsonb_build_object('valor_pago',paid_after,'valor_restante',remaining_after));
  UPDATE public.operational_financial_operations SET result=result WHERE id=p_operation_id;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.registrar_pagamento_entrega(bigint,text,jsonb,text,text,timestamptz,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_pagamento_entrega(bigint,text,jsonb,text,text,timestamptz,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.aprovar_pagamento_oc_financeiro(
  p_oc_id uuid, p_categoria_id bigint, p_data_vencimento date,
  p_forma_pagamento text, p_ja_pago boolean, p_data_pagamento date,
  p_observacao text, p_anexo_url text, p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE org uuid; uid uuid:=auth.uid(); oc public.compras_ordens%ROWTYPE; category public.categorias_financeiras%ROWTYPE;
  op public.operational_financial_operations%ROWTYPE; launch jsonb; result jsonb; launch_id bigint;
BEGIN
  SELECT organization_id INTO org FROM public.auth_context() WHERE ativo IS TRUE;
  IF org IS NULL OR uid IS NULL OR NOT public.has_app_permission('approve_payment_oc') THEN RAISE EXCEPTION 'Cargo sem permissão para aprovar pagamento de OC' USING ERRCODE='42501'; END IF;
  IF p_operation_id IS NULL OR p_data_vencimento IS NULL THEN RAISE EXCEPTION 'Dados de pagamento incompletos'; END IF;
  INSERT INTO public.operational_financial_operations(id,organization_id,user_id,operation_type,source_id)
    VALUES(p_operation_id,org,uid,'oc_pagamento',p_oc_id::text) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN SELECT * INTO STRICT op FROM public.operational_financial_operations WHERE id=p_operation_id; RETURN op.result; END IF;
  SELECT * INTO STRICT oc FROM public.compras_ordens WHERE id=p_oc_id AND organization_id=org FOR UPDATE;
  IF p_categoria_id IS NOT NULL THEN SELECT * INTO STRICT category FROM public.categorias_financeiras WHERE id=p_categoria_id AND organization_id=org; END IF;
  SELECT id INTO launch_id FROM public.lancamentos_financeiros WHERE organization_id=org AND origem='OC#'||oc.numero_pedido AND deleted_at IS NULL ORDER BY id LIMIT 1 FOR UPDATE;
  IF launch_id IS NULL THEN
    launch:=public._insert_operational_financial_entry(org,uid,'ordem_compra',oc.id::text,'oc:'||oc.id::text,
      jsonb_build_object('tipo','despesa','descricao','Compra OC #'||oc.numero_pedido,'valor',oc.valor_total,'data_vencimento',p_data_vencimento,'data_lancamento',current_date,'data_lancamento_real',CASE WHEN p_ja_pago THEN coalesce(p_data_pagamento,current_date) ELSE NULL END,'pago',p_ja_pago,'status',CASE WHEN p_ja_pago THEN 'Pago' ELSE 'Pendente' END,'categoria_id',p_categoria_id,'categoria_nome',coalesce(category.nome,'Compras de Estoque'),'forma_pagamento',p_forma_pagamento,'observacao',p_observacao,'anexo_url',p_anexo_url,'origem','OC#'||oc.numero_pedido,'numero_pedido',oc.numero_pedido,'fornecedor_nome',oc.fornecedor_nome));
    launch_id:=(launch->>'id')::bigint;
  ELSE
    UPDATE public.lancamentos_financeiros SET categoria_id=p_categoria_id,categoria_nome=coalesce(category.nome,categoria_nome),data_vencimento=p_data_vencimento,forma_pagamento=p_forma_pagamento,pago=p_ja_pago,status=CASE WHEN p_ja_pago THEN 'Pago' ELSE 'Pendente' END,data_lancamento_real=CASE WHEN p_ja_pago THEN coalesce(p_data_pagamento,current_date) ELSE NULL END,observacao=coalesce(nullif(p_observacao,''),observacao),anexo_url=coalesce(nullif(p_anexo_url,''),anexo_url),operation_key=coalesce(operation_key,'oc:'||oc.id::text),operation_source_type='ordem_compra',operation_source_id=oc.id::text WHERE id=launch_id;
  END IF;
  UPDATE public.compras_ordens SET pagamento_status='pago',pagamento_aprovado_por=uid,pagamento_aprovado_em=now(),pagamento_forma_final=p_forma_pagamento,pagamento_valor_pago=CASE WHEN p_ja_pago THEN oc.valor_total ELSE NULL END,pagamento_data_pagamento=CASE WHEN p_ja_pago THEN coalesce(p_data_pagamento,current_date) ELSE NULL END,pagamento_observacoes=p_observacao,updated_at=now() WHERE id=oc.id;
  result:=jsonb_build_object('oc_id',oc.id,'lancamento_id',launch_id,'status','pago');
  UPDATE public.operational_financial_operations SET result=result WHERE id=p_operation_id;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.aprovar_pagamento_oc_financeiro(uuid,bigint,date,text,boolean,date,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aprovar_pagamento_oc_financeiro(uuid,bigint,date,text,boolean,date,text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancelar_lancamentos_venda(p_venda_id bigint)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE org uuid; changed integer;
BEGIN
  SELECT organization_id INTO org FROM public.auth_context() WHERE ativo IS TRUE;
  IF org IS NULL OR NOT public.has_app_permission('cancel_vendas') THEN RAISE EXCEPTION 'Cargo sem permissão para cancelar venda' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.vendas WHERE id=p_venda_id AND organization_id=org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada nesta organização'; END IF;
  UPDATE public.lancamentos_financeiros SET status='Cancelado',observacao=concat_ws(' ',nullif(observacao,''),'[VENDA CANCELADA]')
    WHERE organization_id=org AND venda_id=p_venda_id AND deleted_at IS NULL AND status<>'Cancelado';
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN changed;
END;
$$;
REVOKE ALL ON FUNCTION public.cancelar_lancamentos_venda(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_lancamentos_venda(bigint) TO authenticated;

-- Existing atomic operations now enforce the same role matrix before entering
-- their original implementation.
DO $$ BEGIN
  IF to_regprocedure('public._registrar_recebimento_oc_impl(uuid,uuid,jsonb,text,text)') IS NULL THEN
    EXECUTE 'ALTER FUNCTION public.registrar_recebimento_oc(uuid,uuid,jsonb,text,text) RENAME TO _registrar_recebimento_oc_impl';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._registrar_recebimento_oc_impl(uuid,uuid,jsonb,text,text) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.registrar_recebimento_oc(p_ordem_compra_id uuid,p_recebimento_id uuid,p_itens jsonb,p_chave_nfe text DEFAULT NULL,p_observacoes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT (public.has_app_permission('receive_oc') OR public.has_app_permission('manage_compras')) THEN
    RAISE EXCEPTION 'Cargo sem permissão para receber OC' USING ERRCODE='42501';
  END IF;
  RETURN public._registrar_recebimento_oc_impl(p_ordem_compra_id,p_recebimento_id,p_itens,p_chave_nfe,p_observacoes);
END $$;
REVOKE ALL ON FUNCTION public.registrar_recebimento_oc(uuid,uuid,jsonb,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_recebimento_oc(uuid,uuid,jsonb,text,text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
