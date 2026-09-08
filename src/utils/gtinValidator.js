/**
 * Utilitários para validação e normalização de GTIN (EAN/UPC/GTIN) e SKU.
 * Implementa o algoritmo oficial GS1 de dígito verificador para GTIN-8, 12, 13 e 14.
 */

// Valores sintéticos proibidos explicitamente como código de barras
const SYNTHETIC_BARCODE_PATTERNS = [
  /^SEM\s*GTIN$/i,
  /^SOL-/i,
  /^PROD-GENERICO$/i,
  /^SKU-/i,
  /^PRD-/i,
];

/**
 * Calcula o dígito verificador GS1 para uma sequência numérica sem o dígito verificador.
 * Regra GS1: Varrendo da direita para a esquerda, multiplica alternadamente por 3 e por 1.
 * @param {string} digitsWithoutCheckDigit
 * @returns {number} Dígito verificador de 0 a 9
 */
export function calculateGS1CheckDigit(digitsWithoutCheckDigit) {
  let sum = 0;
  let multiplier = 3;

  for (let i = digitsWithoutCheckDigit.length - 1; i >= 0; i -= 1) {
    const digit = parseInt(digitsWithoutCheckDigit[i], 10);
    sum += digit * multiplier;
    multiplier = multiplier === 3 ? 1 : 3;
  }

  return (10 - (sum % 10)) % 10;
}

/**
 * Valida se um código é um GTIN válido (GTIN-8, GTIN-12, GTIN-13 ou GTIN-14)
 * com dígito verificador GS1 correto.
 * Preserva zeros à esquerda tratando sempre como string.
 *
 * @param {any} value
 * @returns {boolean}
 */
export function isValidGTIN(value) {
  if (value === null || value === undefined) return false;
  const str = String(value).trim();

  // Verifica se é valor sintético proibido
  for (const pattern of SYNTHETIC_BARCODE_PATTERNS) {
    if (pattern.test(str)) {
      return false;
    }
  }

  // GTIN deve ter exatamente 8, 12, 13 ou 14 dígitos numéricos
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(str)) {
    return false;
  }

  const payload = str.slice(0, -1);
  const checkDigit = parseInt(str.slice(-1), 10);
  const expectedCheckDigit = calculateGS1CheckDigit(payload);

  return checkDigit === expectedCheckDigit;
}

/**
 * Normaliza um código de barras para persistência.
 * Retorna string limpa se for GTIN válido, ou null se vazio/'SEM GTIN'.
 * Lança erro se informado um valor inválido quando allowNull = false.
 *
 * @param {any} value
 * @param {boolean} [allowNull=true]
 * @returns {string|null}
 */
export function normalizeGTIN(value, allowNull = true) {
  if (value === null || value === undefined) {
    return null;
  }

  const str = String(value).trim();
  if (str === '' || /^SEM\s*GTIN$/i.test(str)) {
    return null;
  }

  if (isValidGTIN(str)) {
    return str;
  }

  if (allowNull) {
    return null;
  }

  throw new Error(`Código de barras inválido: "${str}". Deve ser um GTIN válido (8, 12, 13 ou 14 dígitos).`);
}

/**
 * Normaliza SKU comercial:
 * - Apenas trim de espaços externos
 * - Preserva caracteres significativos como /, ., _, -
 * - Não adiciona sufixos
 *
 * @param {any} value
 * @returns {string}
 */
export function normalizeSKU(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * Gera um SKU único seguro para novos cadastros que não informaram SKU.
 * Formato legível e determinístico na persistência: ex: "SKU-K1A2B3-7F9C"
 *
 * @param {string} [prefix='SKU']
 * @returns {string}
 */
export function generateSafeSKU(prefix = 'SKU') {
  const cleanPrefix = String(prefix || 'SKU').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const timestampPart = Date.now().toString(36).toUpperCase();
  const randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${cleanPrefix}-${timestampPart}-${randomPart}`;
}
