// Never accept browser-shipped shared secrets as user identity.
function createBotAuth(supabase, protectedRoutes) {
    return async (req, res, next) => {
        if (!protectedRoutes.has(req.path) && !req.path.startsWith('/nfe-xml/')) return next();
        const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
        if (!match) return res.status(401).json({ error: 'Não autenticado' });
        try {
            const { data, error } = await supabase.auth.getUser(match[1]);
            if (error || !data?.user) return res.status(401).json({ error: 'Não autenticado' });
            const { data: profile, error: profileError } = await supabase.from('public_users')
                .select('organization_id, cargo, ativo').eq('id', data.user.id).single();
            if (profileError || !profile?.organization_id || profile.ativo !== true) {
                return res.status(403).json({ error: 'Perfil inativo ou sem organização' });
            }
            const supplied = [req.headers['x-organization-id'], req.query?.organization_id, req.body?.organization_id].filter(Boolean);
            if (supplied.some(id => id !== profile.organization_id)) {
                return res.status(403).json({ error: 'Organização divergente' });
            }
            if (req.path === '/logs') return res.status(403).json({ error: 'Logs globais não disponíveis via API' });
            if (/^\/whatsapp\/(reconnect|disconnect|ai-settings|queue\/clear)$/.test(req.path) && profile.cargo !== 'Administrador') {
                return res.status(403).json({ error: 'Acesso restrito a administradores' });
            }
            req.auth = { userId: data.user.id, organizationId: profile.organization_id, role: profile.cargo };
            req.headers['x-organization-id'] = profile.organization_id;
            if (req.body) req.body.organization_id = profile.organization_id;
            next();
        } catch {
            return res.status(503).json({ error: 'Não foi possível validar a sessão' });
        }
    };
}
module.exports = { createBotAuth };
