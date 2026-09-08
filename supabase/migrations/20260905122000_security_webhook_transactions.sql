BEGIN;
CREATE TABLE public.webhook_events (
  provider text NOT NULL,
  event_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'recebido' CHECK(status IN ('recebido','processando','concluido','erro')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider,event_id)
);
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webhook_events FROM anon, authenticated;

ALTER TABLE public.stone_config ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.payment_links ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.cobrancas_pix ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
UPDATE public.payment_links p SET organization_id=v.organization_id FROM public.vendas v WHERE p.venda_id=v.id AND p.organization_id IS NULL;
UPDATE public.cobrancas_pix p SET organization_id=v.organization_id FROM public.vendas v WHERE p.venda_id=v.id AND p.organization_id IS NULL;

CREATE OR REPLACE FUNCTION public.processar_stone_pix_evento(p_event_id text, p_txid text, p_account_id text, p_amount numeric, p_environment text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.cobrancas_pix%ROWTYPE; v public.vendas%ROWTYPE; account text; env text;
BEGIN
  IF nullif(p_event_id,'') IS NULL OR p_amount IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'Evento inválido'; END IF;
  INSERT INTO public.webhook_events(provider,event_id,payload,status)
    VALUES ('stone-pix',p_event_id,jsonb_build_object('id',p_event_id,'status','CONCLUIDA'),'processando')
    ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO STRICT c FROM public.cobrancas_pix WHERE stone_txid=p_txid FOR UPDATE;
  IF c.organization_id IS NULL THEN RAISE EXCEPTION 'Cobrança sem organização'; END IF;
  SELECT valor INTO STRICT account FROM public.configuracoes_sistema WHERE organization_id=c.organization_id AND chave='stone_account_id';
  SELECT valor INTO STRICT env FROM public.configuracoes_sistema WHERE organization_id=c.organization_id AND chave='stone_ambiente';
  IF account IS DISTINCT FROM p_account_id OR env IS DISTINCT FROM p_environment
    OR round(c.valor*100) IS DISTINCT FROM p_amount THEN RAISE EXCEPTION 'Conta, ambiente ou valor divergente'; END IF;
  -- Locking the charge also prevents different event IDs from crediting it twice.
  IF c.status <> 'CONCLUIDA' THEN
    IF c.venda_id IS NULL THEN RAISE EXCEPTION 'Cobrança sem venda'; END IF;
    SELECT * INTO STRICT v FROM public.vendas WHERE id=c.venda_id AND organization_id=c.organization_id FOR UPDATE;
    IF v.status='Cancelado' OR coalesce(v.valor_pago,0)+c.valor>v.valor_total THEN RAISE EXCEPTION 'Saldo divergente'; END IF;
    UPDATE public.cobrancas_pix SET status='CONCLUIDA', valor_pago=c.valor, data_pagamento=now(), webhook_recebido=true,
      webhook_data=jsonb_build_object('event_id',p_event_id,'status','CONCLUIDA') WHERE id=c.id;
    UPDATE public.vendas SET valor_pago=coalesce(valor_pago,0)+c.valor,
      valor_restante=greatest(0,valor_total-coalesce(valor_pago,0)-c.valor),
      status_pagamento=CASE WHEN coalesce(valor_pago,0)+c.valor>=valor_total THEN 'PAGO' ELSE status_pagamento END,
      data_pagamento=now() WHERE id=v.id;
    IF c.entrega_id IS NOT NULL THEN
      UPDATE public.entregas SET pagamento_confirmado=true, data_pagamento=now()
        WHERE id=c.entrega_id AND venda_id=v.id AND organization_id=c.organization_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Entrega divergente'; END IF;
    END IF;
    INSERT INTO public.lancamentos_financeiros(organization_id,descricao,valor,tipo,categoria,data_lancamento,status,forma_pagamento,venda_id,numero_pedido)
      VALUES(c.organization_id,'PIX recebido - pedido ' || coalesce(c.numero_pedido::text,''),c.valor,'receita','Vendas',current_date,'Confirmado','PIX',v.id,c.numero_pedido);
  END IF;
  UPDATE public.webhook_events SET status='concluido' WHERE provider='stone-pix' AND event_id=p_event_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.processar_stone_pix_evento(text,text,text,numeric,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.processar_stone_pix_evento(text,text,text,numeric,text) TO service_role;

CREATE OR REPLACE FUNCTION public.processar_asaas_evento(p_event_id text,p_type text,p_subscription_id text,p_due_date date)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE org public.organizations%ROWTYPE; resources jsonb;
BEGIN
  IF nullif(p_event_id,'') IS NULL OR nullif(p_subscription_id,'') IS NULL OR p_type NOT IN
    ('PAYMENT_CONFIRMED','PAYMENT_RECEIVED','PAYMENT_OVERDUE','PAYMENT_DELETED','SUBSCRIPTION_DELETED') THEN RAISE EXCEPTION 'Evento inválido'; END IF;
  INSERT INTO public.webhook_events(provider,event_id,payload,status)
    VALUES('asaas',p_event_id,jsonb_build_object('id',p_event_id,'status',p_type),'processando') ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO STRICT org FROM public.organizations WHERE asaas_subscription_id=p_subscription_id FOR UPDATE;
  IF p_type IN ('PAYMENT_CONFIRMED','PAYMENT_RECEIVED') THEN
    IF p_due_date IS NULL THEN RAISE EXCEPTION 'Vencimento obrigatório'; END IF;
    UPDATE public.organizations SET status_assinatura='ativa', proxima_cobranca=(p_due_date+interval '1 month')::date WHERE id=org.id;
    IF org.plano_id IS NOT NULL THEN
      SELECT recursos INTO STRICT resources FROM public.planos WHERE id=org.plano_id;
      UPDATE public.organization_settings SET modulos_ativos=resources WHERE organization_id=org.id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Configurações ausentes'; END IF;
    END IF;
  ELSIF p_type='PAYMENT_OVERDUE' THEN
    UPDATE public.organizations SET status_assinatura='atrasada' WHERE id=org.id;
  ELSE
    UPDATE public.organizations SET status_assinatura='cancelada' WHERE id=org.id;
    UPDATE public.organization_settings SET modulos_ativos='{}'::jsonb WHERE organization_id=org.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Configurações ausentes'; END IF;
  END IF;
  UPDATE public.webhook_events SET status='concluido' WHERE provider='asaas' AND event_id=p_event_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.processar_asaas_evento(text,text,text,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.processar_asaas_evento(text,text,text,date) TO service_role;
COMMIT;
