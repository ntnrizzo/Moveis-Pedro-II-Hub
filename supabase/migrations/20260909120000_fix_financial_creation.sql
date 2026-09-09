BEGIN;

-- Do not assign another tenant's ID when the caller omits organization_id.
ALTER TABLE public.lancamentos_financeiros
  ALTER COLUMN organization_id SET DEFAULT public.get_user_org_id();

DROP POLICY IF EXISTS security_insert ON public.lancamentos_financeiros;
CREATE POLICY security_insert ON public.lancamentos_financeiros
FOR INSERT TO authenticated WITH CHECK (
  organization_id = (SELECT organization_id FROM public.auth_context()
    WHERE ativo IS TRUE AND role IN ('Administrador', 'Financeiro'))
);

DROP POLICY IF EXISTS security_insert ON public.categorias_financeiras;
CREATE POLICY security_insert ON public.categorias_financeiras
FOR INSERT TO authenticated WITH CHECK (
  organization_id = (SELECT organization_id FROM public.auth_context()
    WHERE ativo IS TRUE AND role IN ('Administrador', 'Financeiro'))
);

NOTIFY pgrst, 'reload schema';
COMMIT;
