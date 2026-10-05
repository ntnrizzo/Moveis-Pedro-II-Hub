-- MPII Hub V2 — catálogo e resolução de identificadores
-- Esta migration é intencionalmente preparada no repositório.
-- Não aplicar em produção até validarmos o fluxo e as políticas RLS.

create extension if not exists pg_trgm;

create table if not exists public.produto_modelos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nome text not null,
  nome_normalizado text not null,
  categoria text,
  ativo boolean not null default true,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  unique (organization_id, nome_normalizado)
);

create index if not exists idx_produto_modelos_org_nome_trgm
  on public.produto_modelos using gin (nome_normalizado gin_trgm_ops);

create table if not exists public.produto_identificadores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  produto_id bigint not null references public.produtos(id) on delete cascade,
  tipo text not null,
  valor text not null,
  valor_normalizado text not null,
  origem text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  unique (organization_id, tipo, valor_normalizado)
);

create index if not exists idx_produto_identificadores_produto
  on public.produto_identificadores (organization_id, produto_id);

alter table public.produtos
  add column if not exists modelo_id uuid references public.produto_modelos(id) on delete set null;

alter table public.produtos
  add column if not exists cadastro_status text not null default 'completo'
  check (cadastro_status in ('completo', 'incompleto', 'pendente'));

create index if not exists idx_produtos_org_modelo
  on public.produtos (organization_id, modelo_id);

create index if not exists idx_produtos_org_nome_trgm
  on public.produtos using gin (nome gin_trgm_ops);

alter table public.produto_modelos enable row level security;
alter table public.produto_identificadores enable row level security;

create policy "produto_modelos_isolated"
  on public.produto_modelos
  for all
  to authenticated
  using (
    organization_id = (select get_user_org_id())
    or is_saas_operator()
  )
  with check (
    organization_id = (select get_user_org_id())
    or is_saas_operator()
  );

create policy "produto_identificadores_isolated"
  on public.produto_identificadores
  for all
  to authenticated
  using (
    organization_id = (select get_user_org_id())
    or is_saas_operator()
  )
  with check (
    organization_id = (select get_user_org_id())
    or is_saas_operator()
  );

create or replace function public.resolve_or_create_product_identifier(
  p_identifier_type text,
  p_identifier_value text,
  p_name text default null,
  p_price numeric default 0,
  p_category text default null,
  p_barcode text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid;
  v_type text;
  v_value text;
  v_product_id bigint;
  v_created boolean := false;
  v_status text;
begin
  v_org := get_user_org_id();

  if v_org is null then
    raise exception 'Organização não encontrada para o usuário autenticado';
  end if;

  v_type := lower(trim(p_identifier_type));
  v_value := lower(trim(p_identifier_value));

  if v_type = '' or v_value = '' then
    raise exception 'Identificador inválido';
  end if;

  select pi.produto_id
    into v_product_id
  from public.produto_identificadores pi
  where pi.organization_id = v_org
    and pi.tipo = v_type
    and pi.valor_normalizado = v_value
  limit 1;

  if v_product_id is not null then
    select cadastro_status into v_status
    from public.produtos
    where id = v_product_id and organization_id = v_org;

    return jsonb_build_object(
      'product_id', v_product_id,
      'created', false,
      'status', coalesce(v_status, 'incompleto')
    );
  end if;

  -- Mantemos a criação do produto dentro da mesma transação da associação
  -- do identificador para evitar estados intermediários.
  insert into public.produtos (
    nome,
    preco_venda,
    categoria,
    codigo_barras,
    sku,
    organization_id,
    quantidade_estoque,
    cadastro_status,
    requer_atencao
  )
  values (
    coalesce(nullif(trim(p_name), ''), 'Produto ' || p_identifier_value),
    coalesce(p_price, 0),
    nullif(trim(p_category), ''),
    nullif(trim(p_barcode), ''),
    case when v_type = 'sku' then trim(p_identifier_value) else null end,
    v_org,
    0,
    'incompleto',
    true
  )
  returning id into v_product_id;

  insert into public.produto_identificadores (
    organization_id,
    produto_id,
    tipo,
    valor,
    valor_normalizado,
    origem
  )
  values (
    v_org,
    v_product_id,
    v_type,
    trim(p_identifier_value),
    v_value,
    'pdv'
  );

  v_created := true;

  return jsonb_build_object(
    'product_id', v_product_id,
    'created', v_created,
    'status', 'incompleto'
  );

exception
  when unique_violation then
    -- Outra sessão pode ter criado o identificador simultaneamente.
    select pi.produto_id
      into v_product_id
    from public.produto_identificadores pi
    where pi.organization_id = v_org
      and pi.tipo = v_type
      and pi.valor_normalizado = v_value
    limit 1;

    if v_product_id is null then
      raise;
    end if;

    return jsonb_build_object(
      'product_id', v_product_id,
      'created', false,
      'status', 'incompleto',
      'concurrent_resolution', true
    );
end;
$$;

revoke all on function public.resolve_or_create_product_identifier(text, text, text, numeric, text, text)
  from public;

grant execute on function public.resolve_or_create_product_identifier(text, text, text, numeric, text, text)
  to authenticated;

