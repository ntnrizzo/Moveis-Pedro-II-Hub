import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc },
}));

import {
  approvePurchaseOrderPayment,
  createOperationalFinancialEntry,
  registerDeliveryPayment,
  registerSalePayment,
} from '@/services/financialOperations';

describe('financialOperations', () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
  });

  it('sends operational source metadata instead of a client organization id', async () => {
    await createOperationalFinancialEntry({
      sourceType: 'folha',
      sourceId: 'folha-1',
      operationKey: 'folha:1:salario',
      entry: { valor: -100, organization_id: 'ignored-by-server' },
    });

    expect(rpc).toHaveBeenCalledWith('create_operational_financial_entry', {
      p_source_type: 'folha',
      p_source_id: 'folha-1',
      p_operation_key: 'folha:1:salario',
      p_entry: { valor: -100, organization_id: 'ignored-by-server' },
    });
  });

  it('uses one RPC for the complete sale payment mutation', async () => {
    await registerSalePayment({
      saleId: 42,
      payments: [{ forma_pagamento: 'Pix', valor: 50 }],
      paymentDate: '2026-09-09',
      observation: 'parcial',
      operationId: '11111111-1111-4111-8111-111111111111',
    });

    expect(rpc).toHaveBeenCalledWith('registrar_pagamento_venda', expect.objectContaining({
      p_venda_id: 42,
      p_operation_id: '11111111-1111-4111-8111-111111111111',
    }));
  });

  it('uses transactional RPCs for delivery and purchase approval', async () => {
    await registerDeliveryPayment({
      deliveryId: 8,
      paymentStatus: 'pago',
      payments: [{ forma_pagamento: 'Dinheiro', valor: 20 }],
      operationId: '22222222-2222-4222-8222-222222222222',
    });
    await approvePurchaseOrderPayment({
      purchaseOrderId: '33333333-3333-4333-8333-333333333333',
      dueDate: '2026-09-10',
      alreadyPaid: false,
      operationId: '44444444-4444-4444-8444-444444444444',
    });

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'registrar_pagamento_entrega',
      'aprovar_pagamento_oc_financeiro',
    ]);
  });

  it('propagates database permission errors to the UI', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error('Cargo sem permissão') });
    await expect(registerSalePayment({ saleId: 1, payments: [{ valor: 1 }] }))
      .rejects.toThrow('Cargo sem permissão');
  });
});
