/**
 * terminal-safety — sanitizer tests for untrusted terminal output.
 */
import { describe, expect, test } from 'vitest';

import { sanitizeForTerminal, sanitizeUnknownForTerminal } from './terminal-safety.js';

describe('sanitizeForTerminal — bidi controls', () => {
  test.each([
    ['U+202A LRE', '\u202A'],
    ['U+202B RLE', '\u202B'],
    ['U+202C PDF', '\u202C'],
    ['U+202D LRO', '\u202D'],
    ['U+202E RLO', '\u202E'],
    ['U+2066 LRI', '\u2066'],
    ['U+2067 RLI', '\u2067'],
    ['U+2068 FSI', '\u2068'],
    ['U+2069 PDI', '\u2069'],
  ])('strips %s', (_name, ch) => {
    expect(sanitizeForTerminal(`a${ch}b`)).toBe('ab');
  });

  test('strips an RLO that would otherwise reverse a filename', () => {
    expect(sanitizeForTerminal('safe\u202Etxt.exe')).toBe('safetxt.exe');
  });

  test('keeps LRM, RLM, ALM and ZWJ so RTL and emoji text still renders', () => {
    expect(sanitizeForTerminal('a‎b‏c؜d')).toBe('a‎b‏c؜d');
  });

  test('keeps Hebrew and Arabic letters', () => {
    expect(sanitizeForTerminal('שלום עולם')).toBe('שלום עולם');
    expect(sanitizeForTerminal('مرحبا')).toBe('مرحبا');
  });

  test('keeps a ZWJ family emoji sequence', () => {
    expect(sanitizeForTerminal('👨‍👩‍👧')).toBe('👨‍👩‍👧');
  });
});

describe('sanitizeForTerminal — line separators', () => {
  test('U+2028 and U+2029 become newlines', () => {
    expect(sanitizeForTerminal('x\u2028y\u2029z')).toBe('x\ny\nz');
  });

  test('plain spaces are untouched', () => {
    expect(sanitizeForTerminal('x y z')).toBe('x y z');
  });
});

describe('sanitizeForTerminal — existing behaviour is preserved', () => {
  test('keeps tab and newline', () => {
    expect(sanitizeForTerminal('a\tb\nc')).toBe('a\tb\nc');
  });

  test('strips SGR colour sequences', () => {
    expect(sanitizeForTerminal('\u001B[31mred\u001B[0m')).toBe('red');
  });

  test('strips OSC sequences terminated by BEL', () => {
    expect(sanitizeForTerminal('\u001B]0;title\u0007ok')).toBe('ok');
  });

  test('strips C0 control characters', () => {
    expect(sanitizeForTerminal('a\u0007b')).toBe('ab');
  });

  test('strips C1 control characters', () => {
    expect(sanitizeForTerminal('a\u009Bb')).toBe('ab');
  });
});

describe('sanitizeUnknownForTerminal', () => {
  test('sanitizes an error message', () => {
    expect(sanitizeUnknownForTerminal(new Error('x\u202Ey').message)).toBe('xy');
  });

  test('stringifies and sanitizes non-string values', () => {
    expect(sanitizeUnknownForTerminal(42)).toBe('42');
  });
});
