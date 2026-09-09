BEGIN;

-- Production stores permissions as JSON arrays; preserve all existing values.
ALTER TABLE public.role_permissions
  ADD COLUMN IF NOT EXISTS denied_permissions text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS scope text,
  ADD COLUMN IF NOT EXISTS is_custom boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS description text;

CREATE OR REPLACE FUNCTION public.financial_capabilities()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  profile public.public_users%ROWTYPE;
  roles text[];
  allowed text[] := '{}';
  denied text[] := '{}';
  entry record;
  custom jsonb;
  admin boolean := false;
  manage boolean := false;
  view_finance boolean := false;
  approve boolean := false;
BEGIN
  SELECT * INTO profile FROM public.public_users WHERE id = auth.uid();
  IF FOUND AND profile.ativo IS TRUE AND profile.organization_id IS NOT NULL THEN
    SELECT coalesce(array_agg(DISTINCT btrim(r)), '{}'::text[]) INTO roles
    FROM unnest(coalesce(profile.cargos, '{}'::text[]) || ARRAY[profile.cargo]) r
    WHERE r IS NOT NULL AND btrim(r) <> '';
    admin := 'Administrador' = ANY(roles);
    IF cardinality(roles) > 0 AND NOT roles && ARRAY['Cliente', 'cliente'] THEN
      IF roles && ARRAY['Financeiro'] THEN
        allowed := ARRAY['view_financeiro','manage_financeiro'];
      ELSIF roles && ARRAY['Gerente','Gerente Geral'] THEN
        allowed := ARRAY['view_financeiro'];
      END IF;
      FOR entry IN SELECT permissions, denied_permissions FROM public.role_permissions
        WHERE organization_id = profile.organization_id AND cargo = ANY(roles)
      LOOP
        IF jsonb_typeof(entry.permissions) = 'array' THEN
          allowed := allowed || ARRAY(SELECT jsonb_array_elements_text(entry.permissions));
        END IF;
        denied := denied || coalesce(entry.denied_permissions, '{}'::text[]);
      END LOOP;
      SELECT coalesce(array_agg(p), '{}'::text[]) INTO allowed
      FROM unnest(allowed) p WHERE NOT p = ANY(denied);
      custom := profile.custom_permissions;
      IF custom->'inherit' = 'false'::jsonb THEN allowed := '{}'; END IF;
      IF jsonb_typeof(custom->'allowed') = 'array' THEN
        allowed := allowed || ARRAY(SELECT jsonb_array_elements_text(custom->'allowed'));
      END IF;
      IF jsonb_typeof(custom->'denied') = 'array' THEN
        denied := denied || ARRAY(SELECT jsonb_array_elements_text(custom->'denied'));
      END IF;
      -- A denial wins regardless of the order of the user's roles.
      manage := ('manage_financeiro' = ANY(allowed) OR '*' = ANY(allowed))
        AND NOT (denied && ARRAY['manage_financeiro','view_financeiro','*']);
      view_finance := manage OR (('view_financeiro' = ANY(allowed) OR '*' = ANY(allowed))
        AND NOT ('view_financeiro' = ANY(denied) OR '*' = ANY(denied)));
      approve := ('approve_payment_oc' = ANY(allowed) OR '*' = ANY(allowed))
        AND NOT ('approve_payment_oc' = ANY(denied) OR '*' = ANY(denied));
    ELSE
      admin := false;
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'user_id', auth.uid(), 'organization_id', profile.organization_id,
    'view_financeiro', admin OR view_finance,
    'manage_financeiro', admin OR manage,
    'create_financial_category', admin OR manage,
    'manage_financial_categories', admin,
    'delete_financial_entry', admin,
    'approve_payment_oc', admin OR approve
  );
END;
$$;
REVOKE ALL ON FUNCTION public.financial_capabilities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financial_capabilities() TO authenticated;

DROP POLICY IF EXISTS security_select ON public.lancamentos_financeiros;
CREATE POLICY security_select ON public.lancamentos_financeiros FOR SELECT TO authenticated
USING (organization_id = (SELECT organization_id FROM public.auth_context() WHERE ativo IS TRUE)
  AND (SELECT (public.financial_capabilities()->>'view_financeiro')::boolean));
DROP POLICY IF EXISTS security_insert ON public.lancamentos_financeiros;
CREATE POLICY security_insert ON public.lancamentos_financeiros FOR INSERT TO authenticated
WITH CHECK (organization_id = (SELECT organization_id FROM public.auth_context() WHERE ativo IS TRUE)
  AND (SELECT (public.financial_capabilities()->>'manage_financeiro')::boolean));
DROP POLICY IF EXISTS security_update ON public.lancamentos_financeiros;
CREATE POLICY security_update ON public.lancamentos_financeiros FOR UPDATE TO authenticated
USING (organization_id = (SELECT organization_id FROM public.auth_context() WHERE ativo IS TRUE)
  AND (SELECT (public.financial_capabilities()->>'manage_financeiro')::boolean))
WITH CHECK (organization_id = (SELECT organization_id FROM public.auth_context() WHERE ativo IS TRUE)
  AND (SELECT (public.financial_capabilities()->>'manage_financeiro')::boolean));
DROP POLICY IF EXISTS security_delete ON public.lancamentos_financeiros;
CREATE POLICY security_delete ON public.lancamentos_financeiros FOR DELETE TO authenticated
USING (organization_id = (SELECT organization_id FROM public.auth_context() WHERE ativo IS TRUE)
  AND (SELECT (public.financial_capabilities()->>'delete_financial_entry')::boolean));

DROP POLICY IF EXISTS security_insert ON public.categorias_financeiras;
CREATE POLICY security_insert ON public.categorias_financeiras FOR INSERT TO authenticated
WITH CHECK (organization_id = (SELECT organization_id FROM public.auth_context() WHERE ativo IS TRUE)
  AND (SELECT (public.financial_capabilities()->>'create_financial_category')::boolean));
DROP POLICY IF EXISTS security_update ON public.categorias_financeiras;
CREATE POLICY security_update ON public.categorias_financeiras FOR UPDATE TO authenticated
USING (organization_id = (SELECT organization_id FROM public.auth_context() WHERE ativo IS TRUE)
  AND (SELECT (public.financial_capabilities()->>'manage_financial_categories')::boolean))
WITH CHECK (organization_id = (SELECT organization_id FROM public.auth_context() WHERE ativo IS TRUE)
  AND (SELECT (public.financial_capabilities()->>'manage_financial_categories')::boolean));
DROP POLICY IF EXISTS security_delete ON public.categorias_financeiras;
CREATE POLICY security_delete ON public.categorias_financeiras FOR DELETE TO authenticated
USING (organization_id = (SELECT organization_id FROM public.auth_context() WHERE ativo IS TRUE)
  AND (SELECT (public.financial_capabilities()->>'manage_financial_categories')::boolean));

-- Keep ending a series and removing its future occurrences in one transaction.
CREATE OR REPLACE FUNCTION public.delete_financial_recurrence(p_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  target public.lancamentos_financeiros%ROWTYPE;
  parent_id bigint;
  cutoff date;
  removed jsonb;
BEGIN
  IF NOT coalesce((public.financial_capabilities()->>'delete_financial_entry')::boolean, false) THEN
    RAISE EXCEPTION 'Somente administrador pode excluir lançamentos' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO target FROM public.lancamentos_financeiros WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado ou sem permissão'; END IF;
  cutoff := coalesce(target.data_vencimento, target.data_lancamento);
  IF target.recorrente IS TRUE THEN
    parent_id := target.id;
  ELSIF target.origem_ref ~ '^recorrencia:[0-9]+:' THEN
    parent_id := split_part(target.origem_ref, ':', 2)::bigint;
  END IF;
  IF parent_id IS NOT NULL THEN
    IF cutoff IS NULL THEN RAISE EXCEPTION 'Recorrência sem data de referência'; END IF;
    UPDATE public.lancamentos_financeiros SET recorrente = false
      WHERE id = parent_id AND organization_id = target.organization_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Recorrência original não encontrada'; END IF;
  END IF;
  WITH deleted AS (
    DELETE FROM public.lancamentos_financeiros
    WHERE organization_id = target.organization_id AND (
      id = p_id OR (parent_id IS NOT NULL
        AND origem_ref LIKE 'recorrencia:' || parent_id::text || ':%'
        AND coalesce(data_vencimento, data_lancamento) >= cutoff)
    ) RETURNING id
  ) SELECT jsonb_agg(id::text) INTO removed FROM deleted;
  IF removed IS NULL THEN RAISE EXCEPTION 'Nenhum lançamento removido'; END IF;
  RETURN jsonb_build_object('deleted_ids', removed);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_financial_recurrence(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_financial_recurrence(bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
