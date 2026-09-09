import { beforeAll, afterAll, it, expect, vi } from 'vitest';

let base44;
const mock = vi.hoisted(() => ({ from: vi.fn(), auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } }));
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-only');
  vi.stubGlobal('window', { __supabase_instance: mock });
  ({ base44 } = await import('../supabase'));
});
afterAll(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('does not report success or audit a DELETE that RLS filtered to zero rows', async () => {
  const audit = vi.fn();
  const query = {
    select: vi.fn(), eq: vi.fn(), single: vi.fn().mockResolvedValue({data:{id:1}}),
    delete: vi.fn(),
  };
  query.eq.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.delete.mockReturnValue({eq: () => ({select: () => Promise.resolve({data:[],error:null})})});
  mock.from.mockImplementation(table => table === 'audit_logs' ? {insert:audit} : query);
  await expect(base44.entities.LancamentoFinanceiro.delete(1)).rejects.toThrow(/sem permissão para excluir/);
  expect(audit).not.toHaveBeenCalled();
});
