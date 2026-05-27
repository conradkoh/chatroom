import { describe, expect, it } from 'vitest';

import { isInfoLine, parseModelId } from './pure.js';

describe('parseModelId', () => {
  it('parses single-slash model id', () => {
    expect(parseModelId('anthropic/claude-sonnet-4')).toEqual({
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4',
    });
  });

  it('splits on first slash only, preserving trailing path in modelID', () => {
    expect(parseModelId('anthropic/claude-sonnet-4.5/thinking')).toEqual({
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4.5/thinking',
    });
  });

  it('returns undefined for model without slash', () => {
    expect(parseModelId('no-slash-here')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(parseModelId('')).toBeUndefined();
  });

  it('returns undefined for leading slash', () => {
    expect(parseModelId('/foo')).toBeUndefined();
  });

  it('returns undefined for trailing slash', () => {
    expect(parseModelId('foo/')).toBeUndefined();
  });
});

describe('isInfoLine', () => {
  it('returns true for INFO-prefixed line', () => {
    expect(isInfoLine('INFO foo')).toBe(true);
  });

  it('returns true for INFO with multiple spaces', () => {
    expect(isInfoLine('INFO  foo')).toBe(true);
  });

  it('returns true for INFO with leading whitespace', () => {
    expect(isInfoLine('  INFO foo')).toBe(true);
  });

  it('returns false for INFO without trailing space', () => {
    expect(isInfoLine('INFO')).toBe(false);
  });

  it('returns false for INF (no trailing space)', () => {
    expect(isInfoLine('INFOR foo')).toBe(false);
  });

  it('returns false for WARN-prefixed line', () => {
    expect(isInfoLine('WARN foo')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isInfoLine('')).toBe(false);
  });
});
