import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function deny(status: number, message: string): never {
  throw new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

export async function getAuthContext(req: Request) {
  const header = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+$/i.test(header)) deny(401, 'Não autenticado');
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: header } },
    auth: { persistSession: false },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) deny(401, 'Não autenticado');
  const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const { data: profile, error: profileError } = await adminClient.from('public_users')
    .select('organization_id, cargo, ativo').eq('id', data.user.id).single();
  if (profileError || !profile?.organization_id || profile.ativo !== true) deny(403, 'Perfil inativo ou sem organização');
  return { userId: data.user.id, organizationId: profile.organization_id, role: profile.cargo, adminClient };
}

export function requireAdmin(ctx: { role: string }) {
  if (ctx.role !== 'Administrador') deny(403, 'Acesso restrito a administradores');
}

export function requireOrganization(ctx: { organizationId: string }, organizationId: string) {
  if (!organizationId || organizationId !== ctx.organizationId) deny(403, 'Registro fora da organização');
}
