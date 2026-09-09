BEGIN;

CREATE OR REPLACE FUNCTION public.guard_operational_financial_operation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE existing public.operational_financial_operations%ROWTYPE;
BEGIN
  SELECT * INTO existing FROM public.operational_financial_operations WHERE id=NEW.id;
  IF FOUND AND (
    existing.organization_id IS DISTINCT FROM NEW.organization_id
    OR existing.user_id IS DISTINCT FROM NEW.user_id
    OR existing.operation_type IS DISTINCT FROM NEW.operation_type
    OR existing.source_id IS DISTINCT FROM NEW.source_id
  ) THEN
    RAISE EXCEPTION 'Chave de operação pertence a outro contexto' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_operational_financial_operation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_operational_financial_operation ON public.operational_financial_operations;
CREATE TRIGGER guard_operational_financial_operation
BEFORE INSERT ON public.operational_financial_operations
FOR EACH ROW EXECUTE FUNCTION public.guard_operational_financial_operation();

COMMIT;
