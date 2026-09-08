import { CAMPOS_ESTOQUE_LOJA, obterCampoEstoqueDaLoja } from "@/constants/productConstants";

const EXCLUDED_STOCK_FIELDS = new Set([
    'estoque_minimo',
    'estoque_ideal'
]);

/**
 * Maps a human-readable store name (as used in Venda.loja, TransferenciaEstoque, etc.)
 * to the corresponding product database field name.
 *
 * Examples:
 *   "Centro"       → "estoque_centro" (legacy field)
 *   "Mega Store"   → "estoque_mega_store" (legacy field)
 *   "CD"           → "estoque_cd"
 *   "Ponte Branca" → "estoque_ponte_branca" (legacy field)
 *   "Futura"       → "estoque_futura" (legacy field)
 *   "Depósito / CD" → "estoque_cd"
 *
 * @param {string} lojaNome - The store name as displayed in the UI
 * @returns {string|null} The DB field name, or null if not found
 */
export function resolveStockField(lojaNome) {
    if (!lojaNome) return null;
    return obterCampoEstoqueDaLoja(lojaNome);
}

/**
 * Resolves a store id slug from a human-readable store name.
 * @param {string} lojaNome
 * @returns {string|null} The loja id (e.g. "centro", "cd"), or null
 */
export function resolveLojaId(lojaNome) {
    if (!lojaNome) return null;
    const field = obterCampoEstoqueDaLoja(lojaNome);
    if (field.startsWith('estoque_mostruario_')) return field.replace('estoque_mostruario_', '');
    if (field.startsWith('estoque_')) return field.replace('estoque_', '');
    return null;
}

/**
 * Lista os campos de estoque por unidade presentes em um produto.
 * Considera os campos fixos conhecidos e tambem campos dinamicos estoque_*.
 *
 * @param {Object} produto
 * @returns {string[]}
 */
export function getProductStockFields(produto) {
    if (!produto || typeof produto !== 'object') return [];

    const fixedFields = Object.values(CAMPOS_ESTOQUE_LOJA);
    const dynamicFields = Object.keys(produto).filter((key) => {
        if (!key.startsWith('estoque_')) return false;
        if (EXCLUDED_STOCK_FIELDS.has(key)) return false;
        if (key === 'estoque_cd') return true;
        if (key.startsWith('estoque_mostruario_')) return true;
        return produto[key] !== undefined && produto[key] !== null;
    });

    return Array.from(new Set([...fixedFields, ...dynamicFields])).filter((field) => field in produto);
}

/**
 * Soma o estoque agregado de um produto com base nos campos reais por unidade.
 *
 * @param {Object} produto
 * @returns {number}
 */
export function getProductTotalStock(produto) {
    return getProductStockFields(produto).reduce((total, field) => {
        return total + (Number(produto?.[field]) || 0);
    }, 0);
}

// ========================================
// Funções de estoque por VARIANTE (novo padrão Base + Variantes)
// ========================================

/**
 * Consulta o estoque de uma variante em uma loja específica.
 * Retorna a quantidade disponível (0 se não encontrado).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} varianteId - UUID da produto_variante
 * @param {string} lojaId - UUID da loja
 * @returns {Promise<number>}
 */
export async function getVarianteEstoque(supabase, varianteId, lojaId) {
    if (!varianteId || !lojaId) return 0;

    const { data, error } = await supabase
        .from('estoque')
        .select('quantidade')
        .eq('variante_id', varianteId)
        .eq('loja_id', lojaId)
        .maybeSingle();

    if (error) {
        console.error('[stockUtils] Erro ao consultar estoque da variante:', error);
        return 0;
    }

    return Number(data?.quantidade || 0);
}

/**
 * Atualiza (upsert) o estoque de uma variante em uma loja específica.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} varianteId - UUID da produto_variante
 * @param {string} lojaId - UUID da loja
 * @param {number} novaQuantidade - Nova quantidade em estoque
 * @param {string} [organizationId] - UUID da organization
 * @returns {Promise<{success: boolean, error?: any}>}
 */
export async function atualizarEstoqueVariante(supabase, varianteId, lojaId, novaQuantidade, organizationId) {
    if (!varianteId || !lojaId) {
        return { success: false, error: 'variante_id e loja_id são obrigatórios' };
    }

    if (!Number.isSafeInteger(novaQuantidade) || novaQuantidade < 0) return { success: false, error: 'Quantidade inválida' };
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: 'Não autenticado' };
    const { data: profile, error: profileError } = await supabase.from('public_users').select('organization_id, ativo').eq('id', user.id).single();
    if (profileError || !profile?.ativo || !profile.organization_id || (organizationId && organizationId !== profile.organization_id)) return { success: false, error: 'Organização inválida' };
    organizationId = profile.organization_id;
    const { error } = await supabase
        .from('estoque')
        .upsert(
            {
                variante_id: varianteId,
                loja_id: lojaId,
                quantidade: novaQuantidade,
                organization_id: organizationId
            },
            { onConflict: 'variante_id,loja_id' }
        );

    if (error) {
        console.error('[stockUtils] Erro ao atualizar estoque da variante:', error);
        return { success: false, error };
    }

    return { success: true };
}

/**
 * Soma o estoque total de uma variante em TODAS as lojas.
 * Útil para exibir disponibilidade geral na busca de produtos.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} varianteId - UUID da produto_variante
 * @returns {Promise<number>}
 */
export async function getEstoqueTotalVariante(supabase, varianteId) {
    if (!varianteId) return 0;

    const { data, error } = await supabase
        .from('estoque')
        .select('quantidade')
        .eq('variante_id', varianteId);

    if (error) {
        console.error('[stockUtils] Erro ao somar estoque total da variante:', error);
        return 0;
    }

    return (data || []).reduce((sum, row) => sum + (Number(row.quantidade) || 0), 0);
}
