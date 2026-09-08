BEGIN;

-- Financeiro may edit/pay entries in its own organization. Keep deletion and
-- authorization/configuration tables under their existing stricter policies.
DROP POLICY IF EXISTS security_update ON public.lancamentos_financeiros;
CREATE POLICY security_update ON public.lancamentos_financeiros
FOR UPDATE TO authenticated
USING (
  organization_id = (SELECT organization_id FROM public.auth_context()
    WHERE ativo IS TRUE AND role IN ('Administrador', 'Financeiro'))
)
WITH CHECK (
  organization_id = (SELECT organization_id FROM public.auth_context()
    WHERE ativo IS TRUE AND role IN ('Administrador', 'Financeiro'))
);

NOTIFY pgrst, 'reload schema';
COMMIT;
