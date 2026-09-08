BEGIN;
CREATE TABLE public.emissoes_nfe (
  venda_id bigint PRIMARY KEY REFERENCES public.vendas(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  status text NOT NULL DEFAULT 'processando' CHECK (status IN ('processando','concluido','reconciliar')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.emissoes_nfe ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.emissoes_nfe FROM anon, authenticated;

-- Service-only: called after JWT validation and tenant/RBAC checks in the Edge.
CREATE OR REPLACE FUNCTION public.reservar_emissao_nfe(p_venda_id bigint, p_organization_id uuid, p_token_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.vendas%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL THEN RAISE EXCEPTION 'Organização obrigatória'; END IF;
  SELECT * INTO v FROM public.vendas WHERE id=p_venda_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR v.nfe_aprovada IS NOT TRUE OR v.nfe_emitida IS TRUE OR v.status = 'Cancelado' THEN
    RAISE EXCEPTION 'Venda não autorizada para emissão';
  END IF;
  INSERT INTO public.emissoes_nfe(venda_id, organization_id) VALUES (p_venda_id,p_organization_id)
    ON CONFLICT(venda_id) DO NOTHING;
  IF NOT FOUND THEN RAISE EXCEPTION 'Emissão já reservada; reconciliar antes de tentar novamente'; END IF;
  IF p_token_id IS NOT NULL THEN
    UPDATE public.tokens_gerenciais SET usos_realizados=coalesce(usos_realizados,0)+1,
      usado_em=now(), ativo=CASE WHEN tipo_token='SINGLE_USE' THEN false ELSE true END
    WHERE id=p_token_id AND organization_id=p_organization_id AND ativo IS TRUE
      AND permissao='EMITIR_NFE' AND (expira_em IS NULL OR expira_em>now())
      AND (max_usos IS NULL OR max_usos=0 OR coalesce(usos_realizados,0)<max_usos);
    IF NOT FOUND THEN RAISE EXCEPTION 'Token indisponível'; END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.reservar_emissao_nfe(bigint,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservar_emissao_nfe(bigint,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.increment_nfe_number(org_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer;
BEGIN
  IF org_id IS NULL THEN RAISE EXCEPTION 'Organização obrigatória'; END IF;
  UPDATE public.organization_nfe_configs SET ultimo_numero_nfe=coalesce(ultimo_numero_nfe,0)+1
    WHERE organization_id=org_id RETURNING ultimo_numero_nfe INTO STRICT n;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.increment_nfe_number(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_nfe_number(uuid) TO service_role;
COMMIT;
