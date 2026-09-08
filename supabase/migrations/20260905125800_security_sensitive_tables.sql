BEGIN;
DO $$ DECLARE t text; p record; rule text; BEGIN
  rule := 'organization_id=(SELECT organization_id FROM public.auth_context() WHERE ativo IS TRUE AND role=''Administrador'')';
  FOREACH t IN ARRAY ARRAY['stone_config','organization_nfe_configs','configuracoes_sistema','tokens_gerenciais'] LOOP
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I',p.policyname,t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY sensitive_select ON public.%I FOR SELECT TO authenticated USING(%s)',t,rule);
    EXECUTE format('CREATE POLICY sensitive_insert ON public.%I FOR INSERT TO authenticated WITH CHECK(%s)',t,rule);
    EXECUTE format('CREATE POLICY sensitive_update ON public.%I FOR UPDATE TO authenticated USING(%s) WITH CHECK(%s)',t,rule,rule);
    EXECUTE format('CREATE POLICY sensitive_delete ON public.%I FOR DELETE TO authenticated USING(%s)',t,rule);
  END LOOP;
END $$;

ALTER TABLE public.clientes ADD CONSTRAINT clientes_org_id_unique UNIQUE(organization_id,id);
ALTER TABLE public.vendas ADD CONSTRAINT vendas_org_cliente_fk FOREIGN KEY(organization_id,cliente_id) REFERENCES public.clientes(organization_id,id);

CREATE OR REPLACE FUNCTION public.guard_venda_fiscal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cargo text;
BEGIN
  IF auth.role()='service_role' OR auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.nfe_aprovada IS TRUE OR NEW.nfe_emitida IS TRUE OR NEW.nfe_status IS NOT NULL THEN RAISE EXCEPTION 'Estado fiscal deve ser definido pelo servidor'; END IF;
  ELSE
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'Identidade imutável'; END IF;
    IF NEW.nfe_emitida IS DISTINCT FROM OLD.nfe_emitida OR NEW.nfe_status IS DISTINCT FROM OLD.nfe_status THEN RAISE EXCEPTION 'Estado fiscal deve ser definido pelo servidor'; END IF;
    SELECT role INTO cargo FROM public.auth_context() WHERE ativo IS TRUE;
    IF NEW.nfe_aprovada IS DISTINCT FROM OLD.nfe_aprovada AND cargo NOT IN ('Administrador','Gerente','Gerente Geral','Financeiro') THEN RAISE EXCEPTION 'Cargo não permite aprovação fiscal'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_venda_fiscal ON public.vendas;
CREATE TRIGGER guard_venda_fiscal BEFORE INSERT OR UPDATE ON public.vendas FOR EACH ROW EXECUTE FUNCTION public.guard_venda_fiscal();
COMMIT;
