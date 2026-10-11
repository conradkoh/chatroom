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
    expect(sanitizeForTerminal('a\u200Eb\u200Fc\u061Cd')).toBe('a\u200Eb\u200Fc\u061Cd');
  });

  test('keeps Hebrew and Arabic letters', () => {
    expect(sanitizeForTerminal('שלום עולם')).toBe('שלום עולם');
    expect(sanitizeForTerminal('مرحبا')).toBe('مرحبا');
  });

  test('keeps a ZWJ family emoji sequence', () => {
    expect(sanitizeForTerminal('👨\u200D👩\u200D👧')).toBe('👨\u200D👩\u200D👧');
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

describe('carriage returns', () => {
  test('a lone CR becomes a newline', () => {
    expect(sanitizeForTerminal('a\rb')).toBe('a\nb');
  });

  test('CRLF becomes one newline, not two', () => {
    expect(sanitizeForTerminal('a\r\nb')).toBe('a\nb');
  });

  test('a CR followed by CRLF keeps both line breaks', () => {
    expect(sanitizeForTerminal('a\r\r\nb')).toBe('a\n\nb');
  });

  test('a CR cannot overwrite the start of an already-printed line', () => {
    expect(sanitizeForTerminal('rm -rf /\rls')).toBe('rm -rf /\nls');
  });

  test('sanitizes CR in an error message', () => {
    expect(sanitizeUnknownForTerminal(new Error('x\ry').message)).toBe('x\ny');
  });
});

describe('invisible characters', () => {
  test.each([
    ['U+200B zero-width space', '\u200B'],
    ['U+2060 word joiner', '\u2060'],
    ['U+FEFF BOM', '\uFEFF'],
  ])('strips %s', (_name, ch) => {
    expect(sanitizeForTerminal(`a${ch}b`)).toBe('ab');
  });

  test('strips a tag-character sequence', () => {
    expect(
      sanitizeForTerminal('a' + String.fromCodePoint(0xe0001, 0xe0049, 0xe0047, 0xe007f) + 'b')
    ).toBe('ab');
  });

  test('strips every code point in the Unicode tag block (U+E0000–U+E007F)', () => {
    for (let cp = 0xe0000; cp <= 0xe007f; cp++) {
      expect(sanitizeForTerminal('a' + String.fromCodePoint(cp) + 'b')).toBe('ab');
    }
  });

  test('keeps ZWNJ, which Persian text needs', () => {
    const persian = 'می\u200Cخواهم';
    expect(sanitizeForTerminal(persian)).toBe(persian);
  });

  test('keeps a ZWJ family sequence built from escapes', () => {
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
    expect(sanitizeForTerminal(family)).toBe(family);
  });

  test('keeps VS16 emoji presentation selector', () => {
    expect(sanitizeForTerminal('❤\uFE0F')).toBe('❤\uFE0F');
  });

  test.each([
    ['U+180E Mongolian vowel separator', '\u180E'],
    ['U+00AD soft hyphen', '\u00AD'],
    ['U+034F combining grapheme joiner', '\u034F'],
    ['U+115F Hangul choseong filler', '\u115F'],
    ['U+1160 Hangul jungseong filler', '\u1160'],
    ['U+2061 function application', '\u2061'],
    ['U+2062 invisible times', '\u2062'],
    ['U+2063 invisible separator', '\u2063'],
    ['U+2064 invisible plus', '\u2064'],
    ['U+3164 Hangul filler', '\u3164'],
    ['U+FFA0 halfwidth Hangul filler', '\uFFA0'],
  ])('strips %s', (_name, ch) => {
    expect(sanitizeForTerminal(`a${ch}b`)).toBe('ab');
  });

  test('strips every code point in the variation selectors supplement (U+E0100–U+E01EF)', () => {
    for (let cp = 0xe0100; cp <= 0xe01ef; cp++) {
      expect(sanitizeForTerminal('a' + String.fromCodePoint(cp) + 'b')).toBe('ab');
    }
  });

  test('degrades a Scotland flag tag sequence to the base flag', () => {
    const scotland = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}';
    expect(sanitizeForTerminal(scotland)).toBe('\u{1F3F4}');
  });
});

describe('OSC sequences', () => {
  test('visible text between two OSC sequences survives', () => {
    expect(sanitizeForTerminal('\u001B]0;a\u001B\\visible\u001B]0;b\u0007')).toBe('visible');
  });

  test('an OSC sequence terminated by BEL still strips cleanly', () => {
    expect(sanitizeForTerminal('\u001B]0;title\u0007ok')).toBe('ok');
  });

  test('an OSC with no terminator leaves its payload visible once the ESC is stripped', () => {
    expect(sanitizeForTerminal('\u001B]0;title')).toBe(']0;title');
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
