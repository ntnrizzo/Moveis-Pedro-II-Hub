import { describe, it, expect } from 'vitest';
import {
  isValidGTIN,
  calculateGS1CheckDigit,
  normalizeGTIN,
  normalizeSKU,
  generateSafeSKU,
} from './gtinValidator';

describe('gtinValidator', () => {
  describe('calculateGS1CheckDigit', () => {
    it('calculates correct check digit for GTIN-8 (7 digits payload)', () => {
      // 4017072 -> 5 (GTIN-8: 40170725)
      expect(calculateGS1CheckDigit('4017072')).toBe(5);
    });

    it('calculates correct check digit for GTIN-12 (11 digits payload)', () => {
      // 01200005230 -> 9 (GTIN-12: 012000052309)
      expect(calculateGS1CheckDigit('01200005230')).toBe(9);
    });

    it('calculates correct check digit for GTIN-13 (12 digits payload)', () => {
      // 789100031550 -> 7 (GTIN-13: 7891000315507)
      expect(calculateGS1CheckDigit('789100031550')).toBe(7);
    });

    it('calculates correct check digit for GTIN-14 (13 digits payload)', () => {
      // 1789100031550 -> 4 (GTIN-14: 17891000315504)
      expect(calculateGS1CheckDigit('1789100031550')).toBe(4);
    });
  });

  describe('isValidGTIN', () => {
    it('accepts valid GTIN-8', () => {
      expect(isValidGTIN('40170725')).toBe(true);
    });

    it('accepts valid GTIN-12 with leading zeros', () => {
      expect(isValidGTIN('012000052309')).toBe(true);
    });

    it('accepts valid GTIN-13', () => {
      expect(isValidGTIN('7891000315507')).toBe(true);
    });

    it('accepts valid GTIN-14', () => {
      expect(isValidGTIN('17891000315504')).toBe(true);
    });

    it('rejects incorrect checksum', () => {
      // Final digit is 8 instead of 7
      expect(isValidGTIN('7891000315508')).toBe(false);
      expect(isValidGTIN('40170720')).toBe(false);
    });

    it('rejects synthetic and system codes', () => {
      expect(isValidGTIN('SEM GTIN')).toBe(false);
      expect(isValidGTIN('sem gtin')).toBe(false);
      expect(isValidGTIN('SOL-17254829381')).toBe(false);
      expect(isValidGTIN('PROD-GENERICO')).toBe(false);
      expect(isValidGTIN('SKU-12345')).toBe(false);
      expect(isValidGTIN('PRD-1')).toBe(false);
    });

    it('rejects non-numeric characters and wrong lengths', () => {
      expect(isValidGTIN('ABC1234567890')).toBe(false);
      expect(isValidGTIN('1234567')).toBe(false); // 7 digits
      expect(isValidGTIN('123456789')).toBe(false); // 9 digits
      expect(isValidGTIN('12345678901')).toBe(false); // 11 digits
      expect(isValidGTIN('123456789012345')).toBe(false); // 15 digits
      expect(isValidGTIN('')).toBe(false);
      expect(isValidGTIN(null)).toBe(false);
      expect(isValidGTIN(undefined)).toBe(false);
    });

    it('preserves leading zeros without losing characters', () => {
      // '00012345' (8 digits) -> payload '0001234'
      const check = calculateGS1CheckDigit('0001234');
      const gtin8WithZero = `0001234${check}`;
      expect(isValidGTIN(gtin8WithZero)).toBe(true);
    });
  });

  describe('normalizeGTIN', () => {
    it('returns null for empty or SEM GTIN', () => {
      expect(normalizeGTIN('')).toBeNull();
      expect(normalizeGTIN('   ')).toBeNull();
      expect(normalizeGTIN('SEM GTIN')).toBeNull();
      expect(normalizeGTIN(null)).toBeNull();
    });

    it('returns clean GTIN string if valid', () => {
      expect(normalizeGTIN('  7891000315507  ')).toBe('7891000315507');
      expect(normalizeGTIN('012000052309')).toBe('012000052309');
    });

    it('returns null when invalid if allowNull is true', () => {
      expect(normalizeGTIN('INVALID', true)).toBeNull();
      expect(normalizeGTIN('SOL-1234', true)).toBeNull();
    });

    it('throws error when invalid if allowNull is false', () => {
      expect(() => normalizeGTIN('SOL-1234', false)).toThrow(/Código de barras inválido/);
    });
  });

  describe('normalizeSKU', () => {
    it('trims external whitespace without altering internal structure', () => {
      expect(normalizeSKU('  SOFA-3L-RET/REC  ')).toBe('SOFA-3L-RET/REC');
    });

    it('preserves significant punctuation like /, ., _, -', () => {
      expect(normalizeSKU('ALT.GRO_001-AZUL/SUEDE')).toBe('ALT.GRO_001-AZUL/SUEDE');
    });

    it('does not append line numbers or synthetic suffixes', () => {
      expect(normalizeSKU('SKU123')).toBe('SKU123');
    });
  });

  describe('generateSafeSKU', () => {
    it('generates distinct SKUs starting with specified prefix', () => {
      const sku1 = generateSafeSKU('SOL');
      const sku2 = generateSafeSKU('SOL');
      expect(sku1.startsWith('SOL-')).toBe(true);
      expect(sku2.startsWith('SOL-')).toBe(true);
      expect(sku1).not.toBe(sku2);
    });
  });
});
