import { productService } from '@/services/productService';
import { supabase } from '@/lib/supabase';
import { isValidGTIN, normalizeGTIN } from '@/utils/gtinValidator';

/**
 * Normaliza dados retornados pela API externa para formato consistente.
 */
function normalizeApiData(apiData, gtin) {
    if (!apiData) return null;
    return {
        nome: apiData.description || apiData.nome || '',
        ncm: apiData.ncm?.codigo || apiData.ncm || '',
        gtin: gtin,
        marca: apiData.brand?.name || apiData.marca || '',
        foto_url: apiData.thumbnail || apiData.foto_url || '',
        specs: apiData
    };
}

/**
 * Service to identify products by EAN.
 * 1. Checks internal DB strictly by codigo_barras.
 * 2. Checks existing External APIs (Cosmos etc via productService) only for valid GTINs.
 * Returns both internal match and API data when available for comparison.
 */
export const eanService = {
    /**
     * Looks up an EAN. Always attempts API lookup to enable data comparison.
     * @param {string} gtin - Barcode
     * @returns {Promise<{found: boolean, source: 'internal'|'api'|'none', product: object|null, apiData: object|null}>}
     */
    async lookup(gtin) {
        if (!gtin) return { found: false, source: 'none', product: null, apiData: null };
        const rawGtin = String(gtin).trim();
        const validGtin = isValidGTIN(rawGtin) ? normalizeGTIN(rawGtin, true) : rawGtin;

        try {
            // Run internal DB check and external API lookup in parallel
            const [internalResult, apiRaw] = await Promise.all([
                supabase
                    .from('produtos')
                    .select('*')
                    .eq('codigo_barras', validGtin)
                    .maybeSingle(),
                isValidGTIN(rawGtin)
                    ? productService.fetchProductByGtin(validGtin).catch(err => {
                        console.warn('API lookup failed:', err);
                        return null;
                    })
                    : Promise.resolve(null)
            ]);

            const internal = internalResult.data;
            const apiData = normalizeApiData(apiRaw, gtin);

            if (internal) {
                return { found: true, source: 'internal', product: internal, apiData };
            }

            if (apiData && apiData.nome) {
                return { found: true, source: 'api', product: apiData, apiData };
            }

            return { found: false, source: 'none', product: null, apiData: null };

        } catch (err) {
            console.error("EAN Lookup Error:", err);
            return { found: false, source: 'none', product: null, apiData: null, error: err };
        }
    }
};
