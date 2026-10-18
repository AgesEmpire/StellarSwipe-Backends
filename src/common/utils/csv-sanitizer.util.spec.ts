import { sanitizeCsvCell, sanitizeAndEscapeCsvCell } from './csv-sanitizer.util';

describe('csv-sanitizer.util', () => {
  describe('sanitizeCsvCell', () => {
    // --- Formula trigger characters ---
    it.each([
      ['=1+1',        "'=1+1"],
      ['+1+1',        "'+1+1"],
      ['-1+1',        "'-1+1"],
      ['@SUM(A1:A2)', "'@SUM(A1:A2)"],
      ['\tdata',      "'\tdata"],
      ['\rdata',      "'\rdata"],
      ['\ndata',      "'\ndata"],
    ])('prefixes single-quote when value starts with formula trigger: %j', (input, expected) => {
      expect(sanitizeCsvCell(input)).toBe(expected);
    });

    // --- Leading whitespace hiding a formula trigger ---
    it.each([
      [' =cmd',     "'=cmd"],
      ['  +1',      "'+1"],
      ['\t=1',      "'\t=1"],
      [' \t -1',    "'-1"],
      ['\r\n@foo',  "'@foo"],
    ])('strips leading whitespace then detects trigger: %j', (input, expected) => {
      expect(sanitizeCsvCell(input)).toBe(expected);
    });

    // --- Safe values pass through unchanged ---
    it.each([
      ['hello',     'hello'],
      ['XLM/USDC',  'XLM/USDC'],
      ['12345',     '12345'],
      ['',          ''],
    ])('leaves safe value unchanged: %j', (input, expected) => {
      expect(sanitizeCsvCell(input)).toBe(expected);
    });

    // --- Numeric inputs ---
    it('converts numbers to string without prefix', () => {
      expect(sanitizeCsvCell(42)).toBe('42');
      expect(sanitizeCsvCell(0)).toBe('0');
      expect(sanitizeCsvCell(-5)).toBe("'-5");
    });

    // --- Date inputs ---
    it('converts Date to ISO string', () => {
      const d = new Date('2024-06-15T12:00:00Z');
      expect(sanitizeCsvCell(d)).toBe('2024-06-15T12:00:00.000Z');
    });

    // --- Null / undefined ---
    it('returns empty string for null', () => {
      expect(sanitizeCsvCell(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
      expect(sanitizeCsvCell(undefined)).toBe('');
    });

    // --- DDE attack payloads ---
    it('neutralises DDE payload =CMD|…', () => {
      const payload = '=CMD|\'/C calc\'!A0';
      expect(sanitizeCsvCell(payload)).toBe("'" + payload);
    });

    it('neutralises @SUM style payload', () => {
      expect(sanitizeCsvCell('@SUM(A1:A100)')).toBe("'@SUM(A1:A100)");
    });

    // --- Edge: value is only whitespace ---
    it('preserves whitespace-only value when no trigger underneath', () => {
      expect(sanitizeCsvCell('   ')).toBe('   ');
    });
  });

  describe('sanitizeAndEscapeCsvCell', () => {
    it('sanitises and wraps value containing comma', () => {
      expect(sanitizeAndEscapeCsvCell('hello,world')).toBe('"hello,world"');
    });

    it('sanitises and wraps value containing double-quote', () => {
      expect(sanitizeAndEscapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    });

    it('sanitises formula trigger AND wraps when comma present', () => {
      expect(sanitizeAndEscapeCsvCell('=1,2')).toBe("\"'=1,2\"");
    });

    it('sanitises formula trigger without wrapping when no delimiter', () => {
      expect(sanitizeAndEscapeCsvCell('=1+1')).toBe("'=1+1");
    });

    it('returns empty string for null', () => {
      expect(sanitizeAndEscapeCsvCell(null)).toBe('');
    });
  });
});
