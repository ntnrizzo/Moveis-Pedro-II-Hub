const { createClient } = require('@supabase/supabase-js');
const sessions = new Map();

// Server-only dedicated Supabase accounts, one active profile per organization.
// Never reuse the browser-exposed BOT_API_SECRET or an administrator password.
async function getBotJobHeaders(organizationId) {
    if (!organizationId) throw new Error('Organização obrigatória');
    const cached = sessions.get(organizationId);
    if (cached?.expiresAt > Date.now()) return cached.headers;
    const accounts = JSON.parse(process.env.BOT_SERVICE_ACCOUNTS || '{}');
    const account = accounts[organizationId];
    if (!account?.email || !account?.password || !process.env.SUPABASE_ANON_KEY) {
        throw new Error('Conta de serviço JWT não configurada para esta organização');
    }
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.signInWithPassword(account);
    if (error || !data.session) throw new Error('Falha na autenticação da conta de serviço');
    const { data: profile, error: profileError } = await client.from('public_users')
        .select('organization_id,cargo,ativo').eq('id', data.user.id).single();
    if (profileError || !profile?.ativo || profile.organization_id !== organizationId || profile.cargo !== 'Bot') {
        throw new Error('Perfil da conta de serviço inválido');
    }
    const headers = { 'Content-Type': 'application/json', 'x-organization-id': organizationId, Authorization: `Bearer ${data.session.access_token}` };
    sessions.set(organizationId, { headers, expiresAt: (data.session.expires_at * 1000) - 60000 });
    return headers;
}
module.exports = { getBotJobHeaders };
