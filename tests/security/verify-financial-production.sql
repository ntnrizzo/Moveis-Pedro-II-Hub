-- Read-only verification of deployed rules. Does not create business records.
-- Uses a stored active Financeiro profile to evaluate the server resolver;
-- this is not a substitute for logging in and testing the published frontend.
DO $$
DECLARE
  finance_user uuid;
  capabilities jsonb;
  default_expression text;
BEGIN
  SELECT id INTO finance_user FROM public.public_users
    WHERE ativo IS TRUE AND cargo = 'Financeiro' LIMIT 1;
  IF finance_user IS NULL THEN
    RAISE EXCEPTION 'Nenhum perfil Financeiro ativo encontrado';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', finance_user::text, true);
  capabilities := public.financial_capabilities();
  IF NOT coalesce((capabilities->>'manage_financeiro')::boolean, false)
    OR coalesce((capabilities->>'delete_financial_entry')::boolean, false) THEN
    RAISE EXCEPTION 'Permissões do Financeiro divergentes: verificar concessões e negações';
  END IF;
  SELECT column_default INTO default_expression
    FROM information_schema.columns WHERE table_schema='public'
      AND table_name='lancamentos_financeiros' AND column_name='organization_id';
  IF default_expression NOT LIKE '%get_user_org_id()%' THEN
    RAISE EXCEPTION 'Default de organização não corrigido';
  END IF;
END;
$$;
SELECT 'Financeiro ativo: criação/edição permitidas, exclusão bloqueada e organização derivada' AS verificacao;
