import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { identityKey, offlineSalesStore } from './identityStorage';
const require = createRequire(import.meta.url);
const { createBotAuth } = require('../../robo-whatsapp-agendamentos/authMiddleware.js');

function setup(profile = { organization_id: 'org-a', cargo: 'Vendedor', ativo: true }) {
    const single = vi.fn().mockResolvedValue({ data: profile });
    const client = {
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-a' } } }) },
        from: vi.fn(() => ({ select: () => ({ eq: () => ({ single }) }) })),
    };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    return { client, res, next: vi.fn(), middleware: createBotAuth(client, new Set(['/send-text', '/whatsapp/disconnect'])) };
}

describe('bot identity boundary', () => {
    it('rejects the exposed shared key even when the server secret is missing', async () => {
        const { middleware, res, next, client } = setup();
        await middleware({ path: '/send-text', headers: { 'x-bot-api-key': 'old-secret' } }, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
        expect(client.auth.getUser).not.toHaveBeenCalled();
    });
    it('rejects invalid JWTs and inactive users', async () => {
        const first = setup();
        first.client.auth.getUser.mockResolvedValue({ error: new Error('invalid') });
        await first.middleware({ path: '/send-text', headers: { authorization: 'Bearer invalid' } }, first.res, first.next);
        expect(first.res.status).toHaveBeenCalledWith(401);
        const second = setup({ organization_id: 'org-a', cargo: 'Administrador', ativo: false });
        await second.middleware({ path: '/send-text', headers: { authorization: 'Bearer valid' } }, second.res, second.next);
        expect(second.res.status).toHaveBeenCalledWith(403);
    });
    it('rejects a tenant supplied by the caller that differs from the profile', async () => {
        const { middleware, res, next } = setup();
        await middleware({ path: '/send-text', headers: { authorization: 'Bearer valid' }, body: { organization_id: 'org-b' } }, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });
    it('derives the organization from the validated profile', async () => {
        const { middleware, res, next } = setup();
        const req = { path: '/send-text', headers: { authorization: 'Bearer valid' }, body: {} };
        await middleware(req, res, next);
        expect(req.auth.organizationId).toBe('org-a');
        expect(req.body.organization_id).toBe('org-a');
        expect(next).toHaveBeenCalledOnce();
    });
    it('does not let a seller disconnect the organization bot', async () => {
        const { middleware, res, next } = setup();
        await middleware({ path: '/whatsapp/disconnect', headers: { authorization: 'Bearer valid' } }, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });
});

describe('offline ownership', () => {
    it('requires both identities', () => {
        expect(() => identityKey('cart', null, 'user')).toThrow();
        expect(() => identityKey('cart', 'org', null)).toThrow();
    });
    it('isolates queues, rejects mismatched owners, and uses UUID sale IDs', () => {
        const data = new Map();
        const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
        const a = offlineSalesStore('org-a', 'user-a', storage);
        const b = offlineSalesStore('org-b', 'user-a', storage);
        const c = offlineSalesStore('org-a', 'user-b', storage);
        a.save({ valor_total: 10 });
        expect(b.get()).toEqual([]);
        expect(c.get()).toEqual([]);
        expect(a.get()[0].id).toMatch(/^[\da-f-]{36}$/);
        expect(a.get()[0].id).toBe(a.get()[0].offlineId);
        data.set(identityKey('pending_sales_offline', 'org-a', 'user-a'), JSON.stringify([{ organization_id: 'org-b', offlineUserId: 'user-a' }]));
        expect(a.get()).toEqual([]);
    });
});
