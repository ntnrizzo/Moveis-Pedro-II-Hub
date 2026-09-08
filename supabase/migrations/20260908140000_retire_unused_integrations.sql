BEGIN;

-- Signatures verified against the linked database on 2026-09-08.
-- Keep historical documents, sales and the shared Asaas event ledger.
DROP FUNCTION IF EXISTS public.reservar_emissao_nfe(bigint,uuid,uuid);
DROP FUNCTION IF EXISTS public.increment_nfe_number(uuid);
DROP FUNCTION IF EXISTS public.processar_stone_pix_evento(text,text,text,numeric,text);

REVOKE ALL ON TABLE public.stone_config FROM anon, authenticated;

-- The company form continues to use organization_nfe_configs for its public
-- company/tax fields. Hide only provider credentials, including from SELECT *.
DO $$
DECLARE allowed_columns text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
  INTO allowed_columns
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='organization_nfe_configs'
    AND column_name NOT LIKE 'acbr_%'
    AND column_name NOT ILIKE '%secret%'
    AND column_name NOT ILIKE '%token%'
    AND column_name NOT ILIKE '%password%'
    AND column_name NOT ILIKE '%senha%'
    AND column_name NOT ILIKE '%certificado%';
  REVOKE ALL ON public.organization_nfe_configs FROM anon, authenticated;
  IF allowed_columns IS NOT NULL THEN
    EXECUTE format('GRANT SELECT (%s), INSERT (%s), UPDATE (%s) ON public.organization_nfe_configs TO authenticated', allowed_columns, allowed_columns, allowed_columns);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
