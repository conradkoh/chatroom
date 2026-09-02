import { describe, expect, it } from 'vitest';

import { decodeClaudeVariant } from './claude-models.js';

describe('decodeClaudeVariant', () => {
  it('decodes canonical effort variant', () =>
    expect(decodeClaudeVariant('claude-sonnet-4-6[effort=high]')).toEqual({
      model: 'claude-sonnet-4-6',
      effort: 'high',
    }));
  it('strips the catalog provider prefix', () =>
    expect(decodeClaudeVariant('anthropic/claude-sonnet-4-6[effort=high]')).toEqual({
      model: 'claude-sonnet-4-6',
      effort: 'high',
    }));
  it('accepts plain legacy model ids', () => {
    expect(decodeClaudeVariant('sonnet')).toEqual({ model: 'sonnet' });
    expect(decodeClaudeVariant('claude-sonnet-4-6')).toEqual({ model: 'claude-sonnet-4-6' });
  });
  it('accepts confirmed-working spawn aliases (resolved by claude CLI)', () => {
    // These bare aliases are resolved by the claude CLI subprocess — confirmed working via live spawn.
    expect(decodeClaudeVariant('haiku')).toEqual({ model: 'haiku' });
    expect(decodeClaudeVariant('opus')).toEqual({ model: 'opus' });
    expect(decodeClaudeVariant('sonnet')).toEqual({ model: 'sonnet' });
  });
  it('accepts spawn aliases with effort variants', () => {
    expect(decodeClaudeVariant('haiku[effort=high]')).toEqual({ model: 'haiku', effort: 'high' });
    expect(decodeClaudeVariant('opus[effort=max]')).toEqual({ model: 'opus', effort: 'max' });
  });
  it('accepts claude-opus-5 catalog model id', () => {
    // claude-opus-5 is confirmed working via live spawn test.
    expect(decodeClaudeVariant('claude-opus-5')).toEqual({ model: 'claude-opus-5' });
    expect(decodeClaudeVariant('anthropic/claude-opus-5')).toEqual({ model: 'claude-opus-5' });
    expect(decodeClaudeVariant('claude-opus-5[effort=high]')).toEqual({
      model: 'claude-opus-5',
      effort: 'high',
    });
  });
  it('omits none effort', () =>
    expect(decodeClaudeVariant('sonnet[effort=none]')).toEqual({ model: 'sonnet' }));
  it('rejects malformed and unknown variants', () => {
    expect(() => decodeClaudeVariant('sonnet[effort')).toThrow();
    expect(() => decodeClaudeVariant('sonnet[effort=ultra]')).toThrow();
  });
});
