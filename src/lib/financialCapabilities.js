export const FINANCIAL_CAPABILITIES = new Set([
  'view_financeiro', 'manage_financeiro', 'create_financial_category',
  'manage_financial_categories', 'delete_financial_entry', 'approve_payment_oc',
]);

export function financialErrorMessage(error) {
  if (error?.code === '42501' || /row-level security/i.test(error?.message || '')) {
    return 'Seu acesso não permite esta operação financeira nesta empresa. Atualize a sessão ou solicite a revisão das permissões ao administrador.';
  }
  return error?.message || 'Não foi possível concluir a operação financeira.';
}

export function createFinancialAccessLoader(client, identity, onChange) {
  let disposed = false;
  let version = 0;
  return {
    async refresh() {
      const request = ++version;
      try {
        const { data, error } = await client.rpc('financial_capabilities');
        if (disposed || request !== version) return;
        onChange(!error && data?.user_id === identity.id &&
          data?.organization_id === identity.organization_id ? data : null);
      } catch {
        if (!disposed && request === version) onChange(null);
      }
    },
    dispose() { disposed = true; },
  };
}
