BEGIN;
-- Do not silently assign legacy stock to a default organization or clamp losses.
-- Any existing NULL/negative/cross-tenant record must be reconciled before deploy.
ALTER TABLE public.produto_variantes ADD CONSTRAINT produto_variantes_org_id_unique UNIQUE(organization_id,id);
ALTER TABLE public.lojas ADD CONSTRAINT lojas_org_id_unique UNIQUE(organization_id,id);
ALTER TABLE public.estoque
  ALTER COLUMN organization_id SET NOT NULL,
  ALTER COLUMN quantidade SET NOT NULL,
  ADD CONSTRAINT estoque_quantidade_nao_negativa CHECK(quantidade>=0),
  ADD CONSTRAINT estoque_org_variante_fk FOREIGN KEY(organization_id,variante_id) REFERENCES public.produto_variantes(organization_id,id),
  ADD CONSTRAINT estoque_org_loja_fk FOREIGN KEY(organization_id,loja_id) REFERENCES public.lojas(organization_id,id);

CREATE POLICY security_stock_tenant_guard ON public.estoque AS RESTRICTIVE FOR ALL TO authenticated
USING(organization_id=(SELECT organization_id FROM public.auth_context() WHERE ativo IS TRUE))
WITH CHECK(organization_id=(SELECT organization_id FROM public.auth_context() WHERE ativo IS TRUE));

CREATE OR REPLACE FUNCTION public.baixar_estoque(p_variante_id uuid,p_organization_id uuid,p_quantidade integer,p_loja_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE org uuid;
BEGIN
  SELECT organization_id INTO org FROM public.auth_context() WHERE ativo IS TRUE;
  IF org IS NULL OR p_organization_id IS DISTINCT FROM org OR p_loja_id IS NULL OR p_variante_id IS NULL
    OR p_quantidade IS NULL OR p_quantidade<=0 THEN RAISE EXCEPTION 'Identidade/quantidade inválida'; END IF;
  UPDATE public.estoque SET quantidade=quantidade-p_quantidade
  WHERE variante_id=p_variante_id AND organization_id=org AND loja_id=p_loja_id AND quantidade>=p_quantidade;
  IF NOT FOUND THEN RAISE EXCEPTION 'Estoque insuficiente ou variante indisponível'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.baixar_estoque(uuid,uuid,integer,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.baixar_estoque(uuid,uuid,integer,uuid) TO authenticated;
COMMIT;
