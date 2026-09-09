import { supabase } from '@/lib/supabase';

const createOperationId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-4000-8000-${Math.random().toString(16).slice(2)}`;
};

const unwrap = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export async function createOperationalFinancialEntry({
  sourceType,
  sourceId,
  operationKey,
  entry,
}) {
  if (!sourceType || sourceId === null || sourceId === undefined) {
    throw new Error('Origem obrigatória para o lançamento automático.');
  }

  return unwrap(await supabase.rpc('create_operational_financial_entry', {
    p_source_type: sourceType,
    p_source_id: String(sourceId),
    p_operation_key: operationKey || `${sourceType}:${sourceId}:${createOperationId()}`,
    p_entry: entry,
  }));
}

export async function registerSalePayment({
  saleId,
  payments,
  paymentDate,
  observation,
  operationId = createOperationId(),
}) {
  return unwrap(await supabase.rpc('registrar_pagamento_venda', {
    p_venda_id: saleId,
    p_pagamentos: payments,
    p_data_pagamento: paymentDate || new Date().toISOString().slice(0, 10),
    p_observacao: observation || null,
    p_operation_id: operationId,
  }));
}

export async function registerDeliveryPayment({
  deliveryId,
  paymentStatus,
  payments,
  pendingReason,
  receiptUrl,
  paymentDateIso,
  operationId = createOperationId(),
}) {
  return unwrap(await supabase.rpc('registrar_pagamento_entrega', {
    p_entrega_id: deliveryId,
    p_pagamento_status: paymentStatus,
    p_pagamentos: payments || [],
    p_motivo_pendente: pendingReason || null,
    p_comprovante_url: receiptUrl || null,
    p_data_pagamento: paymentDateIso || new Date().toISOString(),
    p_operation_id: operationId,
  }));
}

export async function approvePurchaseOrderPayment({
  purchaseOrderId,
  categoryId,
  dueDate,
  paymentMethod,
  alreadyPaid,
  paymentDate,
  observation,
  attachmentUrl,
  operationId = createOperationId(),
}) {
  return unwrap(await supabase.rpc('aprovar_pagamento_oc_financeiro', {
    p_oc_id: purchaseOrderId,
    p_categoria_id: categoryId || null,
    p_data_vencimento: dueDate,
    p_forma_pagamento: paymentMethod || null,
    p_ja_pago: Boolean(alreadyPaid),
    p_data_pagamento: alreadyPaid ? (paymentDate || new Date().toISOString().slice(0, 10)) : null,
    p_observacao: observation || null,
    p_anexo_url: attachmentUrl || null,
    p_operation_id: operationId,
  }));
}

export async function cancelSaleFinancialEntries(saleId) {
  return unwrap(await supabase.rpc('cancelar_lancamentos_venda', { p_venda_id: saleId }));
}

export { createOperationId };
