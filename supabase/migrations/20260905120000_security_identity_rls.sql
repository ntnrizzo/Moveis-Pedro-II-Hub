BEGIN;

ALTER TABLE public.public_users ADD COLUMN IF NOT EXISTS last_seen timestamptz;
ALTER TABLE public.public_users ADD COLUMN IF NOT EXISTS updated_at timestamptz;

CREATE OR REPLACE FUNCTION public.auth_context()
RETURNS TABLE(organization_id uuid, role text, ativo boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT u.organization_id, u.cargo::text, u.ativo
  FROM public.public_users u WHERE u.id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.auth_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_context() TO authenticated, service_role;

-- Remove every permissive legacy policy; policies are ORed by PostgreSQL.
DO $$
DECLARE t text; p record; admin_check text; org_check text;
BEGIN
  org_check := 'organization_id = (SELECT organization_id FROM public.auth_context() WHERE ativo IS TRUE)';
  admin_check := org_check || ' AND (SELECT role FROM public.auth_context()) = ''Administrador''';
  FOREACH t IN ARRAY ARRAY['public_users','role_permissions','tokens_gerenciais',
    'configuracoes_sistema','configuracao_taxas','configuracao_comissoes','configuracao_prazos',
    'lancamentos_financeiros','parcelas','categorias_financeiras','compras_contas_pagar',
    'conferencias_caixa','clientes','vendas'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY security_select ON public.%I FOR SELECT TO authenticated USING (%s)', t, org_check);
    IF t IN ('clientes','vendas') THEN
      EXECUTE format('CREATE POLICY security_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)', t, org_check);
      EXECUTE format('CREATE POLICY security_update ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', t, org_check, org_check);
      EXECUTE format('CREATE POLICY security_delete ON public.%I FOR DELETE TO authenticated USING (%s)', t, admin_check);
    ELSE
      EXECUTE format('CREATE POLICY security_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)', t, admin_check);
      EXECUTE format('CREATE POLICY security_update ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', t, admin_check, admin_check);
      EXECUTE format('CREATE POLICY security_delete ON public.%I FOR DELETE TO authenticated USING (%s)', t, admin_check);
    END IF;
  END LOOP;
END $$;

CREATE POLICY security_profile_self ON public.public_users FOR UPDATE TO authenticated
USING (id = auth.uid() AND organization_id = (SELECT organization_id FROM public.auth_context() WHERE ativo IS TRUE))
WITH CHECK (id = auth.uid() AND organization_id = (SELECT organization_id FROM public.auth_context() WHERE ativo IS TRUE));

-- RLS cannot compare OLD/NEW. A trigger protects ALL authorization attributes,
-- including custom_permissions and future columns, without recursive policies.
CREATE OR REPLACE FUNCTION public.guard_profile_authorization()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx record;
BEGIN
  IF auth.role() = 'service_role' OR auth.uid() IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO ctx FROM public.auth_context();
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'Identidade e organização imutáveis' USING ERRCODE='42501';
  END IF;
  IF ctx.ativo IS TRUE AND ctx.role = 'Administrador' AND OLD.id <> auth.uid()
    AND OLD.organization_id = ctx.organization_id THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW) - ARRAY['nome','full_name','telefone','avatar_url','primeiro_acesso','last_seen','updated_at'])
    IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['nome','full_name','telefone','avatar_url','primeiro_acesso','last_seen','updated_at']) THEN
    RAISE EXCEPTION 'Alteração de privilégios não permitida' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_profile_authorization BEFORE UPDATE ON public.public_users
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_authorization();

REVOKE ALL ON public.clientes FROM anon;
CREATE POLICY security_portal_client_select ON public.clientes FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY security_portal_sale_select ON public.vendas FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = vendas.cliente_id AND c.user_id = auth.uid()
    AND c.organization_id = vendas.organization_id)
);

-- Close the existing arbitrary-user overload as well as adding the safe API.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='track_user_footstep' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.signature);
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.track_user_footstep()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.public_users SET last_seen = now() WHERE id = auth.uid() AND ativo IS TRUE
$$;
REVOKE ALL ON FUNCTION public.track_user_footstep() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.track_user_footstep() TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
