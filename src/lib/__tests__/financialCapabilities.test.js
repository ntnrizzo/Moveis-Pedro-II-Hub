import { it, expect, vi } from 'vitest';
import { createFinancialAccessLoader, financialErrorMessage } from '../financialCapabilities';

const identity = { id: 'user-a', organization_id: 'org-a' };
const allowed = { user_id: 'user-a', organization_id: 'org-a', manage_financeiro: true };
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

it('does not let an older response restore a permission after revocation', async () => {
  const old = deferred();
  const latest = deferred();
  const rpc = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  const changed = vi.fn();
  const loader = createFinancialAccessLoader({ rpc }, identity, changed);
  const a = loader.refresh();
  const b = loader.refresh();
  const denied = { ...allowed, manage_financeiro: false };
  latest.resolve({ data: denied }); await b;
  old.resolve({ data: allowed }); await a;
  expect(changed.mock.calls).toEqual([[denied]]);
});

it('drops pending responses when the user or organization changes', async () => {
  const pending = deferred();
  const changed = vi.fn();
  const loader = createFinancialAccessLoader({ rpc: () => pending.promise }, identity, changed);
  const request = loader.refresh();
  loader.dispose();
  pending.resolve({ data: allowed }); await request;
  expect(changed).not.toHaveBeenCalled();
});

it('fails closed on mismatched identity, RPC errors and connection failures', async () => {
  const changed = vi.fn();
  const rpc = vi.fn()
    .mockResolvedValueOnce({ data: { ...allowed, organization_id: 'org-b' } })
    .mockResolvedValueOnce({ data: { ...allowed, user_id: 'user-b' } })
    .mockResolvedValueOnce({ error: { code: '42501' } })
    .mockRejectedValueOnce(new Error('offline'));
  const loader = createFinancialAccessLoader({ rpc }, identity, changed);
  for (let i = 0; i < 4; i++) await loader.refresh();
  expect(changed.mock.calls).toEqual([[null],[null],[null],[null]]);
  expect(financialErrorMessage({code:'42501'})).toContain('Seu acesso não permite');
});
