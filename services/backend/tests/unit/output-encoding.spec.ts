import { describe, expect, test } from 'vitest';

import { encodeOutput, decodeOutput } from '../../src/output-encoding';

describe('encodeOutput', () => {
  test('compresses ASCII text', () => {
    const result = encodeOutput('hello world');
    expect(result.compression).toBe('gzip');
    expect(typeof result.content).toBe('string');
    expect(result.content.length).toBeGreaterThan(0);
  });

  test('compresses UTF-8 text', () => {
    const result = encodeOutput('Hello 🌍 world — em dash and © symbol');
    expect(result.compression).toBe('gzip');
    const decoded = decodeOutput(result);
    expect(decoded).toBe('Hello 🌍 world — em dash and © symbol');
  });

  test('compresses ANSI escape sequences', () => {
    const ansi = '\x1B[32mgreen\x1B[0m \x1B[1mbold\x1B[0m \x1B[31merror\x1B[0m';
    const result = encodeOutput(ansi);
    expect(result.compression).toBe('gzip');
    const decoded = decodeOutput(result);
    expect(decoded).toBe(ansi);
  });

  test('handles empty string', () => {
    const result = encodeOutput('');
    expect(result.compression).toBe('gzip');
    const decoded = decodeOutput(result);
    expect(decoded).toBe('');
  });

  test('handles very long text', () => {
    const long = 'x'.repeat(200 * 1024);
    const result = encodeOutput(long);
    expect(result.compression).toBe('gzip');
    expect(result.content.length).toBeLessThan(long.length);
    const decoded = decodeOutput(result);
    expect(decoded).toBe(long);
  });
});

describe('decodeOutput', () => {
  test('passes through legacy plain string', () => {
    expect(decodeOutput('hello world')).toBe('hello world');
  });

  test('passes through empty plain string', () => {
    expect(decodeOutput('')).toBe('');
  });

  test('handles UTF-8 plain string', () => {
    expect(decodeOutput('café résumé')).toBe('café résumé');
  });

  test('round-trips ASCII', () => {
    const original = 'The quick brown fox jumps over the lazy dog.';
    const encoded = encodeOutput(original);
    expect(decodeOutput(encoded)).toBe(original);
  });

  test('round-trips multi-line text', () => {
    const original = `Line 1
Line 2
Line 3`;
    const encoded = encodeOutput(original);
    expect(decodeOutput(encoded)).toBe(original);
  });

  test('round-trips binary-looking ANSI bytes', () => {
    const original = '\x1B[1;31mERROR\x1B[0m: something went wrong\n\x1B[33mWARN\x1B[0m: check config';
    const encoded = encodeOutput(original);
    expect(decodeOutput(encoded)).toBe(original);
  });

  test('round-trips large text within chunk limit', () => {
    const original = 'Hello\n'.repeat(10000);
    const encoded = encodeOutput(original);
    const decoded = decodeOutput(encoded);
    expect(decoded.length).toBe(original.length);
    expect(decoded).toBe(original);
  });
});

describe('encodeOutput compression ratio', () => {
  test('compresses repetitive text well', () => {
    const text = 'Log line with some repeated content\n'.repeat(5000);
    const encoded = encodeOutput(text);
    const ratio = text.length / encoded.content.length;
    expect(ratio).toBeGreaterThan(2);
  });

  test('compresses ANSI-heavy output well', () => {
    const text = '\x1B[32m[INFO]\x1B[0m Request processed in 12ms\n'.repeat(1000);
    const encoded = encodeOutput(text);
    const ratio = text.length / encoded.content.length;
    expect(ratio).toBeGreaterThan(2);
  });
});
