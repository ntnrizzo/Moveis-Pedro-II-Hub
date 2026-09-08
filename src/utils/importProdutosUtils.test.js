import { describe, it, expect } from 'vitest';
import {
  normalizeSkuForComparison,
  normalizeSkuForStorage,
  validateImportPlanilha,
  buildInsertProductPayload,
  buildUpdateProductPayload,
} from './importProdutosUtils';

describe('importProdutosUtils', () => {
  const orgIdA = '00000000-0000-0000-0000-000000000001';
  const orgIdB = '00000000-0000-0000-0000-000000000002';

  describe('normalizeSkuForComparison & normalizeSkuForStorage', () => {
    it('normalizes comparison case-insensitively and trims whitespace', () => {
      expect(normalizeSkuForComparison('  ABC-123.4/XY  ')).toBe('abc-123.4/xy');
    });

    it('preserves significant punctuation like /, ., _, - in storage', () => {
      expect(normalizeSkuForStorage('  ALT-001/BRANCO_1.2  ')).toBe('ALT-001/BRANCO_1.2');
    });

    it('does not append line numbers or suffixes to SKU', () => {
      expect(normalizeSkuForStorage('ABC123')).toBe('ABC123');
    });
  });

  describe('validateImportPlanilha', () => {
    it('identifies new products vs re-imports updating the same ID', () => {
      const produtosExistentes = [
        { id: 'uuid-1', sku: 'ABC-100', nome: 'Produto Existente', organization_id: orgIdA },
      ];

      const rows = [
        { linha: 1, sku: 'ABC-100', nome: 'Produto Atualizado' },
        { linha: 2, sku: 'XYZ-200', nome: 'Produto Novo' },
      ];

      const result = validateImportPlanilha({
        rows,
        produtosExistentes,
        organizationId: orgIdA,
      });

      expect(result.isValid).toBe(true);
      expect(result.novos).toHaveLength(1);
      expect(result.novos[0].sku).toBe('XYZ-200');

      expect(result.atualizacoes).toHaveLength(1);
      expect(result.atualizacoes[0].sku).toBe('ABC-100');
      expect(result.atualizacoes[0].id_existente).toBe('uuid-1');
    });

    it('blocks import when SKU is missing and reports the line numbers', () => {
      const rows = [
        { linha: 1, sku: 'SKU-OK', nome: 'Item 1' },
        { linha: 2, sku: '', nome: 'Item 2 Sem SKU' },
        { linha: 3, sku: null, nome: 'Item 3 Nulo' },
      ];

      const result = validateImportPlanilha({
        rows,
        produtosExistentes: [],
        organizationId: orgIdA,
      });

      expect(result.isValid).toBe(false);
      const skuErrors = result.errors.filter(e => e.tipo === 'SKU_OBRIGATORIO');
      expect(skuErrors).toHaveLength(2);
      expect(skuErrors.map(e => e.linha)).toEqual([2, 3]);
    });

    it('blocks import when same SKU appears multiple times in CSV and lists all conflicting lines', () => {
      const rows = [
        { linha: 1, sku: 'PROD-A', nome: 'Item Linha 1' },
        { linha: 5, sku: 'PROD-B', nome: 'Item Linha 5' },
        { linha: 12, sku: 'prod-a', nome: 'Item Linha 12 (Duplicado case-insensitive)' },
      ];

      const result = validateImportPlanilha({
        rows,
        produtosExistentes: [],
        organizationId: orgIdA,
      });

      expect(result.isValid).toBe(false);
      expect(result.skuDuplicates).toHaveLength(1);
      expect(result.skuDuplicates[0].linhas).toEqual([1, 12]);
    });

    it('permits same SKU in different organizations without conflict', () => {
      // Existente na Org B
      const produtosExistentesOrgB = [
        { id: 'uuid-b', sku: 'ABC-100', organization_id: orgIdB },
      ];

      // Importando na Org A (produtos existentes da Org A é vazio)
      const rows = [
        { linha: 1, sku: 'ABC-100', nome: 'Produto na Org A' },
      ];

      const result = validateImportPlanilha({
        rows,
        produtosExistentes: [], // Apenas produtos da Org A
        organizationId: orgIdA,
      });

      expect(result.isValid).toBe(true);
      expect(result.novos).toHaveLength(1);
      expect(result.novos[0].sku).toBe('ABC-100');
    });

    it('rejects invalid GTIN with clear error and preserves zeros when valid', () => {
      const rows = [
        { linha: 1, sku: 'SKU-1', codigo_barras: 'INVALID_EAN', nome: 'Item' },
        { linha: 2, sku: 'SKU-2', codigo_barras: '012000052309', nome: 'Item 2' }, // GTIN-12 com zero
      ];

      const result = validateImportPlanilha({
        rows,
        produtosExistentes: [],
        organizationId: orgIdA,
      });

      expect(result.isValid).toBe(false);
      const eanErrors = result.errors.filter(e => e.tipo === 'EAN_INVALIDO');
      expect(eanErrors).toHaveLength(1);
      expect(eanErrors[0].linha).toBe(1);

      // Linha 2 foi normalizada com zero preservado
      const item2 = result.novos.find(n => n.sku === 'SKU-2');
      expect(item2.codigo_barras).toBe('012000052309');
    });

    it('blocks import if the same EAN belongs to different SKUs in the same sheet', () => {
      const validEan = '7891000315507';
      const rows = [
        { linha: 1, sku: 'SKU-AAA', codigo_barras: validEan },
        { linha: 2, sku: 'SKU-BBB', codigo_barras: validEan },
      ];

      const result = validateImportPlanilha({
        rows,
        produtosExistentes: [],
        organizationId: orgIdA,
      });

      expect(result.isValid).toBe(false);
      const err = result.errors.find(e => e.tipo === 'EAN_DUPLICADO_ENTRE_SKUS');
      expect(err).toBeDefined();
    });

    it('blocks import if an EAN in CSV is already used by a different SKU in DB', () => {
      const validEan = '7891000315507';
      const produtosExistentes = [
        { id: 'id-1', sku: 'SKU-EXISTING', codigo_barras: validEan, organization_id: orgIdA },
      ];

      const rows = [
        { linha: 3, sku: 'SKU-NEW', codigo_barras: validEan },
      ];

      const result = validateImportPlanilha({
        rows,
        produtosExistentes,
        organizationId: orgIdA,
      });

      expect(result.isValid).toBe(false);
      const err = result.errors.find(e => e.tipo === 'EAN_JA_CADASTRADO_OUTRO_SKU');
      expect(err).toBeDefined();
      expect(err.linha).toBe(3);
    });

    it('blocks import when ID and SKU point to divergent products', () => {
      const produtosExistentes = [
        { id: 'uuid-real', sku: 'SKU-ORIGINAL', organization_id: orgIdA },
      ];

      const rows = [
        { linha: 4, id: 'uuid-real', sku: 'SKU-DIVERGENTE', nome: 'Divergente' },
      ];

      const result = validateImportPlanilha({
        rows,
        produtosExistentes,
        organizationId: orgIdA,
      });

      expect(result.isValid).toBe(false);
      const err = result.errors.find(e => e.tipo === 'CONFLITO_ID_SKU');
      expect(err).toBeDefined();
      expect(err.linha).toBe(4);
    });

    it('allows products without EAN (null barcode)', () => {
      const rows = [
        { linha: 1, sku: 'SKU-NO-EAN', codigo_barras: '', nome: 'Produto Sem EAN' },
        { linha: 2, sku: 'SKU-SEM-GTIN', codigo_barras: 'SEM GTIN', nome: 'Sem GTIN' },
      ];

      const result = validateImportPlanilha({
        rows,
        produtosExistentes: [],
        organizationId: orgIdA,
      });

      expect(result.isValid).toBe(true);
      expect(result.novos[0].codigo_barras).toBeNull();
      expect(result.novos[1].codigo_barras).toBeNull();
    });

    it('allows multiple variations without EAN', () => {
      const rows = [
        {
          linha: 1,
          sku: 'SOFA-MODULAR',
          cor: 'Cinza, Azul, Bege',
          modelos_tecidos: 'Suede, Linho',
          codigo_barras: '',
        },
      ];

      const result = validateImportPlanilha({
        rows,
        produtosExistentes: [],
        organizationId: orgIdA,
      });

      expect(result.isValid).toBe(true);
    });

    it('blocks a line with multiple variations having only one single EAN (ambiguity)', () => {
      const validEan = '7891000315507';
      const rows = [
        {
          linha: 7,
          sku: 'SOFA-VAR',
          cor: 'Preto, Branco',
          codigo_barras: validEan,
        },
      ];

      const result = validateImportPlanilha({
        rows,
        produtosExistentes: [],
        organizationId: orgIdA,
      });

      expect(result.isValid).toBe(false);
      const err = result.errors.find(e => e.tipo === 'EAN_AMBIGUO_VARIACOES');
      expect(err).toBeDefined();
      expect(err.linha).toBe(7);
    });

    it('never changes identity based on line number or order', () => {
      const rowA = { linha: 99, sku: 'SKU-STABLE', codigo_barras: '7891000315507' };
      const rowB = { linha: 1, sku: 'SKU-STABLE', codigo_barras: '7891000315507' };

      const resA = validateImportPlanilha({ rows: [rowA], organizationId: orgIdA });
      const resB = validateImportPlanilha({ rows: [rowB], organizationId: orgIdA });

      expect(resA.novos[0].sku).toBe(resB.novos[0].sku);
      expect(resA.novos[0].codigo_barras).toBe(resB.novos[0].codigo_barras);
    });
  });

  describe('buildInsertProductPayload and buildUpdateProductPayload', () => {
    it('creates full insert payload with safe defaults', () => {
      const row = {
        sku: 'ALT-100',
        codigo_barras: '7891000315507',
        nome: 'Mesa de Jantar',
        modelo_referencia: 'MJ-01',
        preco_custo: 200,
        preco_venda: 450,
      };

      const payload = buildInsertProductPayload(row, orgIdA);

      expect(payload.sku).toBe('ALT-100');
      expect(payload.codigo_barras).toBe('7891000315507');
      expect(payload.organization_id).toBe(orgIdA);
      expect(payload.ativo).toBe(true);
      expect(payload.quantidade_estoque).toBe(0);
      expect(payload.modelo_referencia).toBe('MJ-01'); // Without line suffix!
    });

    it('creates partial update payload preserving photos, variations and stock', () => {
      const row = {
        sku: 'ALT-100',
        nome: 'Mesa Atualizada',
        preco_venda: 499.90,
      };

      const payload = buildUpdateProductPayload(row);

      expect(payload.nome).toBe('Mesa Atualizada');
      expect(payload.preco_venda).toBe(499.90);
      // Ensure missing fields are not sent as empty arrays or reset
      expect(payload).not.toHaveProperty('fotos');
      expect(payload).not.toHaveProperty('variacoes');
      expect(payload).not.toHaveProperty('ativo');
      expect(payload).not.toHaveProperty('quantidade_estoque');
      expect(payload).not.toHaveProperty('parent_id');
    });
  });
});
