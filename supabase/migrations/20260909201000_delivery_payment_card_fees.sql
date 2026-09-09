BEGIN;

-- Card fees belong to the same transaction as the delivery payment. If the
-- fee cannot be recorded, the sale and delivery updates are rolled back too.
CREATE OR REPLACE FUNCTION public.record_delivery_payment_fees()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  delivery public.entregas%ROWTYPE;
  payment jsonb;
  fee public.configuracao_taxas%ROWTYPE;
  method_key text;
  fee_method_key text;
  fee_value numeric;
  payment_index integer:=0;
BEGIN
  IF NEW.operation_type<>'entrega_pagamento' OR NEW.result='{}'::jsonb
    OR coalesce((NEW.result->>'valorRecebido')::numeric,0)<=0 THEN
    RETURN NEW;
  END IF;
  SELECT * INTO STRICT delivery FROM public.entregas
    WHERE id=NEW.source_id::bigint AND organization_id=NEW.organization_id;
  FOR payment IN SELECT value FROM jsonb_array_elements(coalesce(NEW.result->'pagamentos','[]'::jsonb)) LOOP
    payment_index:=payment_index+1;
    method_key:=translate(lower(coalesce(payment->>'forma_pagamento','')),'áàâãéêíóôõúç','aaaaeeiooouc');
    IF method_key NOT LIKE '%credito%' AND method_key NOT LIKE '%debito%'
      AND method_key NOT LIKE '%multicredito%' AND method_key NOT LIKE '%afesp%' THEN
      CONTINUE;
    END IF;
    SELECT * INTO fee FROM public.configuracao_taxas c
      WHERE c.organization_id=NEW.organization_id AND coalesce(c.ativa,true)
        AND (
          translate(lower(c.forma_pagamento),'áàâãéêíóôõúç','aaaaeeiooouc')=method_key
          OR (method_key='credito 1x' AND translate(lower(c.forma_pagamento),'áàâãéêíóôõúç','aaaaeeiooouc')='credito')
        )
      ORDER BY c.created_at DESC LIMIT 1;
    IF NOT FOUND OR coalesce(fee.valor,0)<=0 THEN CONTINUE; END IF;
    fee_method_key:=translate(lower(coalesce(fee.tipo_taxa,'')),'áàâãéêíóôõúç','aaaaeeiooouc');
    fee_value:=CASE WHEN fee_method_key LIKE 'porcent%' THEN
      ((payment->>'valor')::numeric*fee.valor/100) ELSE fee.valor END;
    IF fee_value<=0 THEN CONTINUE; END IF;
    PERFORM public._insert_operational_financial_entry(
      NEW.organization_id,NEW.user_id,'entrega',delivery.id::text,
      'entrega:'||delivery.id::text||':pagamento:'||NEW.id::text||':taxa:'||payment_index::text,
      jsonb_build_object(
        'descricao','Taxa '||(payment->>'forma_pagamento')||' - Recebido na Entrega #'||coalesce(delivery.numero_pedido,''),
        'valor',-fee_value,'tipo','despesa','data_vencimento',current_date,'data_lancamento',current_date,
        'data_lancamento_real',current_date,'pago',true,'categoria_nome','Taxas de Cartão',
        'forma_pagamento',payment->>'forma_pagamento','status','Pago',
        'observacao',fee.valor::text||CASE WHEN fee_method_key LIKE 'porcent%' THEN '% sobre R$ ' ELSE ' R$ sobre R$ ' END||(payment->>'valor'),
        'venda_id',delivery.venda_id,'numero_pedido',delivery.numero_pedido
      )
    );
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.record_delivery_payment_fees() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS record_delivery_payment_fees ON public.operational_financial_operations;
CREATE TRIGGER record_delivery_payment_fees
AFTER UPDATE OF result ON public.operational_financial_operations
FOR EACH ROW
WHEN (OLD.result='{}'::jsonb AND NEW.result<>'{}'::jsonb)
EXECUTE FUNCTION public.record_delivery_payment_fees();

NOTIFY pgrst, 'reload schema';
COMMIT;
