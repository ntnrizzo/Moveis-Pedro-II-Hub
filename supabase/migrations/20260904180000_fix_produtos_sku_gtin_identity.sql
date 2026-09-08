-- ============================================================================
-- Migration: Corrigir identidade de produtos (SKU vs Código de Barras GTIN)
-- Data: 2026-09-04
-- ============================================================================

-- 1. Adicionar coluna sku na tabela produtos se não existir
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS sku text;

-- 2. Garantir que organization_id possui default e preparar para NOT NULL
ALTER TABLE public.produtos
  ALTER COLUMN organization_id SET DEFAULT public.get_user_org_id();

-- 3. Função nativa para cálculo e validação do dígito verificador GS1 (GTIN-8, 12, 13, 14)
CREATE OR REPLACE FUNCTION public.validar_gtin(p_gtin text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_trimmed text;
  v_len int;
  v_sum int := 0;
  v_multiplier int := 3;
  v_i int;
  v_digit int;
  v_check_digit int;
  v_expected_check int;
BEGIN
  IF p_gtin IS NULL THEN
    RETURN true;
  END IF;

  v_trimmed := trim(p_gtin);

  -- Rejeitar valores sintéticos conhecidos
  IF v_trimmed ~* '^SEM\s*GTIN$' OR v_trimmed ~* '^SOL-' OR v_trimmed ~* '^PROD-GENERICO' OR v_trimmed ~* '^SKU-' OR v_trimmed ~* '^PRD-' THEN
    RETURN false;
  END IF;

  -- Deve conter estritamente 8, 12, 13 ou 14 dígitos numéricos
  IF NOT (v_trimmed ~ '^[0-9]{8}$|^[0-9]{12}$|^[0-9]{13}$|^[0-9]{14}$') THEN
    RETURN false;
  END IF;

  v_len := length(v_trimmed);
  v_check_digit := (substring(v_trimmed from v_len for 1))::int;

  -- Varre da direita para a esquerda excluindo o último dígito
  FOR v_i IN REVERSE (v_len - 1)..1 LOOP
    v_digit := (substring(v_trimmed from v_i for 1))::int;
    v_sum := v_sum + (v_digit * v_multiplier);
    IF v_multiplier = 3 THEN
      v_multiplier := 1;
    ELSE
      v_multiplier := 3;
    END IF;
  END LOOP;

  v_expected_check := (10 - (v_sum % 10)) % 10;

  RETURN v_check_digit = v_expected_check;
END;
$$;

-- 4. Remover constraints comprovadamente incorretas
DO $$
DECLARE
  r RECORD;
BEGIN
  -- Remover unicidade global de codigo_barras (ex: produtos_codigo_barras_key)
  FOR r IN (
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.produtos'::regclass
      AND contype = 'u'
      AND conname IN (
        'produtos_codigo_barras_key',
        'produtos_codigo_barras_organization_id_key'
      )
  ) LOOP
    EXECUTE 'ALTER TABLE public.produtos DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
  END LOOP;

  -- Remover unicidade de modelo_referencia
  FOR r IN (
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.produtos'::regclass
      AND contype = 'u'
      AND conname IN (
        'produtos_modelo_referencia_organization_id_key',
        'produtos_modelo_referencia_key'
      )
  ) LOOP
    EXECUTE 'ALTER TABLE public.produtos DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
  END LOOP;

  -- Remover índices únicos antigos correspondentes se existirem
  DROP INDEX IF EXISTS public.idx_produtos_codigo_barras_unique;
  DROP INDEX IF EXISTS public.idx_produtos_modelo_referencia_unique;
  DROP INDEX IF EXISTS public.produtos_codigo_barras_key;
  DROP INDEX IF EXISTS public.produtos_codigo_barras_organization_id_key;
  DROP INDEX IF EXISTS public.produtos_modelo_referencia_organization_id_key;
END $$;

-- 5. Criar constraint de validação para codigo_barras
-- Permite NULL. Se preenchido, deve ser GTIN válido de 8, 12, 13 ou 14 dígitos com checksum.
DO $$
BEGIN
  ALTER TABLE public.produtos DROP CONSTRAINT IF EXISTS chk_produtos_codigo_barras_gtin;
  ALTER TABLE public.produtos ADD CONSTRAINT chk_produtos_codigo_barras_gtin
    CHECK (
      codigo_barras IS NULL 
      OR (
        codigo_barras ~ '^[0-9]{8}$|^[0-9]{12}$|^[0-9]{13}$|^[0-9]{14}$'
        AND public.validar_gtin(codigo_barras)
      )
    );
END $$;

-- 6. Unicidade de codigo_barras por tenant (apenas para valores preenchidos)
DROP INDEX IF EXISTS public.idx_produtos_codigo_barras_org;
CREATE UNIQUE INDEX idx_produtos_codigo_barras_org 
  ON public.produtos (organization_id, codigo_barras) 
  WHERE codigo_barras IS NOT NULL AND codigo_barras <> '';

-- 7. Unicidade case-insensitive e sem espaços externos de SKU por tenant
DROP INDEX IF EXISTS public.idx_produtos_sku_org;
CREATE UNIQUE INDEX idx_produtos_sku_org 
  ON public.produtos (organization_id, lower(trim(sku))) 
  WHERE sku IS NOT NULL;

-- 8. Garantir que sku e organization_id são obrigatórios na base
-- Executado após a base ser limpa
ALTER TABLE public.produtos ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.produtos ALTER COLUMN sku SET NOT NULL;

NOTIFY pgrst, 'reload schema';
