BEGIN;
CREATE TABLE public.contadores_oc (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  ano integer NOT NULL,
  ultimo_numero integer NOT NULL DEFAULT 0,
  PRIMARY KEY(organization_id,ano)
);
ALTER TABLE public.contadores_oc ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contadores_oc FROM anon, authenticated;
-- Preserve the highest existing number, including gaps caused by deletions.
INSERT INTO public.contadores_oc(organization_id,ano,ultimo_numero)
SELECT organization_id, split_part(numero_pedido,'-',2)::integer, max(split_part(numero_pedido,'-',3)::integer)
FROM public.compras_ordens WHERE organization_id IS NOT NULL AND numero_pedido ~ '^OC-[0-9]{4}-[0-9]+$'
GROUP BY organization_id,split_part(numero_pedido,'-',2)::integer;

CREATE OR REPLACE FUNCTION public.proximo_numero_oc(p_ano integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE org uuid; n integer;
BEGIN
  SELECT organization_id INTO org FROM public.auth_context() WHERE ativo IS TRUE;
  IF org IS NULL OR p_ano IS NULL OR p_ano < 2000 OR p_ano > 9999 THEN RAISE EXCEPTION 'Identidade/ano inválidos'; END IF;
  INSERT INTO public.contadores_oc(organization_id,ano,ultimo_numero) VALUES(org,p_ano,1)
    ON CONFLICT(organization_id,ano) DO UPDATE SET ultimo_numero=public.contadores_oc.ultimo_numero+1
    RETURNING ultimo_numero INTO n;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.proximo_numero_oc(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proximo_numero_oc(integer) TO authenticated;
CREATE UNIQUE INDEX compras_ordens_org_numero_unique ON public.compras_ordens(organization_id,numero_pedido);
COMMIT;
