import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

function load(file, dependencies = {}) {
    const source = readFileSync(new URL(`../../supabase/functions/${file}`, import.meta.url), 'utf8');
    const { code } = transformSync(source, { loader: 'ts', format: 'cjs' });
    const module = { exports: {} };
    vm.runInNewContext(code, { module, exports: module.exports, Response, Request, console, Deno: { env: { get: key => key } },
        require: name => { if (!(name in dependencies)) throw new Error(`Unexpected import: ${name}`); return dependencies[name]; },
    });
    return module.exports;
}

function fixture(profile = { organization_id: 'org-a', cargo: 'Vendedor', ativo: true }) {
    const userClient = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-a' } } }) } };
    const single = vi.fn().mockResolvedValue({ data: profile });
    const adminClient = { from: vi.fn(() => ({ select: () => ({ eq: () => ({ single }) }) })) };
    const createClient = vi.fn().mockReturnValueOnce(userClient).mockReturnValueOnce(adminClient);
    const auth = load('_shared/authContext.ts', { 'https://esm.sh/@supabase/supabase-js@2': { createClient } });
    return { auth, createClient, userClient, adminClient };
}

describe('Edge authorization context', () => {
    it('rejects anonymous calls before constructing privileged clients', async () => {
        const { auth, createClient } = fixture();
        await expect(auth.getAuthContext(new Request('https://example.test'))).rejects.toMatchObject({ status: 401 });
        expect(createClient).not.toHaveBeenCalled();
    });
    it('validates a JWT as the user and derives organization from the stored profile', async () => {
        const { auth, createClient } = fixture();
        const ctx = await auth.getAuthContext(new Request('https://example.test', { headers: { Authorization: 'Bearer jwt' } }));
        expect(ctx).toMatchObject({ userId: 'user-a', organizationId: 'org-a', role: 'Vendedor' });
        expect(createClient.mock.calls[0][1]).toBe('SUPABASE_ANON_KEY');
        expect(createClient.mock.calls[0][2].global.headers.Authorization).toBe('Bearer jwt');
    });
    it('rejects inactive profiles', async () => {
        const { auth } = fixture({ organization_id: 'org-a', cargo: 'Administrador', ativo: false });
        await expect(auth.getAuthContext(new Request('https://example.test', { headers: { Authorization: 'Bearer jwt' } }))).rejects.toMatchObject({ status: 403 });
    });
    it('rejects cross-organization access and non-administrators', () => {
        const { auth } = fixture();
        for (const run of [() => auth.requireOrganization({ organizationId: 'org-a' }, 'org-b'), () => auth.requireAdmin({ role: 'Vendedor' })]) {
            let error;
            try { run(); } catch (e) { error = e; }
            expect(error?.status).toBe(403);
        }
    });
});

it('all modified Edge functions parse as TypeScript', () => {
    for (const name of ['admin-actions','criar-assinatura','asaas-webhook']) {
        const source = readFileSync(new URL(`../../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8');
        expect(() => transformSync(source, { loader: 'ts', format: 'esm' })).not.toThrow();
    }
});

it('admin-actions returns 403 for a foreign target without resetting a password', async () => {
    const { auth } = fixture();
    let handler;
    const updateUserById = vi.fn();
    const adminClient = {
        auth: { admin: { updateUserById } },
        from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { organization_id: 'org-b', email: 'target@example.test' } }) }) }) }),
    };
    load('admin-actions/index.ts', {
        '../_shared/authContext.ts': { ...auth, getAuthContext: async () => ({ role: 'Administrador', organizationId: 'org-a', adminClient }) },
        'https://deno.land/std@0.168.0/http/server.ts': { serve: fn => { handler = fn; } },
        'https://esm.sh/@supabase/supabase-js@2.39.0': { createClient: vi.fn() },
    });
    const response = await handler(new Request('https://example.test', { method: 'POST', body: JSON.stringify({ action: 'reset_password', user_id: 'foreign-user' }) }));
    expect(response.status).toBe(403);
    expect(updateUserById).not.toHaveBeenCalled();
});
