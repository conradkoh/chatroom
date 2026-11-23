import { describe, expect, it } from 'vitest';

import { decodeHtmlEntities } from './decodeHtmlEntities';

// Built from a char code so this file never holds a literal out-of-range entity.
const AMP = String.fromCharCode(38);

describe('decodeHtmlEntities', () => {
  it('decodes entities repeatedly', () => {
    expect(decodeHtmlEntities('&amp;lt;p&amp;gt;')).toBe('<p>');
    expect(decodeHtmlEntities('&amp;amp;amp;nbsp;')).toBe('\u00a0');
  });

  describe('numeric references', () => {
    it('returns unchanged the numeric entity for code point 0x110000 without throwing', () => {
      const input = `${AMP}#1114112;`;
      expect(() => decodeHtmlEntities(input)).not.toThrow();
      expect(decodeHtmlEntities(input)).toBe(input);
    });

    it('returns unchanged a hex entity above 0x10FFFF (1FFFFF) without throwing', () => {
      const input = `${AMP}#x1FFFFF;`;
      expect(() => decodeHtmlEntities(input)).not.toThrow();
      expect(decodeHtmlEntities(input)).toBe(input);
    });

    it('returns unchanged a decimal of about 1e20 without throwing', () => {
      const input = `${AMP}#100000000000000000000;`;
      expect(() => decodeHtmlEntities(input)).not.toThrow();
      expect(decodeHtmlEntities(input)).toBe(input);
    });

    it('returns unchanged the double-encoded form of the 0x110000 entity without throwing', () => {
      const input = `${AMP}amp;#1114112;`;
      expect(() => decodeHtmlEntities(input)).not.toThrow();
      expect(decodeHtmlEntities(input)).toBe(input);
    });

    it('decodes decimal 65 to A', () => {
      expect(decodeHtmlEntities(`${AMP}#65;`)).toBe('A');
    });

    it('decodes the largest code point in hex (10FFFF) and in decimal (1114111)', () => {
      expect(decodeHtmlEntities(`${AMP}#x10FFFF;`)).toBe('\u{10FFFF}');
      expect(decodeHtmlEntities(`${AMP}#1114111;`)).toBe('\u{10FFFF}');
    });

    it('keeps valid entities decoding while an out-of-range neighbour passes through', () => {
      const bad = `${AMP}#1114112;`;
      expect(decodeHtmlEntities(`a ${bad} b ${AMP}#65;`)).toBe(`a ${bad} b A`);
    });
  });
});
