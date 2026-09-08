// Limpeza administrativa destrutiva. Execute somente em ambiente autorizado:
// SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/limpar_produtos.mjs --confirm-delete-products
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente; não grave credenciais neste arquivo.');
}

if (!process.argv.includes('--confirm-delete-products')) {
  throw new Error('Operação destrutiva bloqueada. Use --confirm-delete-products após confirmar o ambiente.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function cleanAll() {
  const tablesToClean = [
    'compras_recebimentos_historico', 'compras_oc_itens', 'compras_contas_pagar',
    'compras_ordens', 'solicitacoes_encomenda', 'solicitacoes_reposicao',
    'solicitacoes_preco', 'historico_precos', 'promocoes_fornecedor',
    'solicitacoes_cadastro_produto', 'movimentacoes_estoque', 'alertas_recompra',
    'transferencias_estoque', 'itens_pedido_compra', 'pedidos_compra',
    'itens_nota_fiscal', 'itens_nfe_emitida', 'produtos',
  ];

  for (const table of tablesToClean) {
    const { error } = await supabase.from(table).delete().not('id', 'is', null);
    if (error) throw new Error(`Falha ao limpar ${table}: ${error.message}`);
  }
}

cleanAll().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
