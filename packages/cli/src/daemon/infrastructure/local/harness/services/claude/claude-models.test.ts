import { describe, expect, it } from 'vitest';

import { decodeClaudeVariant } from './claude-models.js';

describe('decodeClaudeVariant', () => {
  it('decodes canonical effort variant', () => expect(decodeClaudeVariant('claude-sonnet-4-6[effort=high]')).toEqual({ model: 'claude-sonnet-4-6', effort: 'high' }));
  it('strips the catalog provider prefix', () => expect(decodeClaudeVariant('anthropic/claude-sonnet-4-6[effort=high]')).toEqual({ model: 'claude-sonnet-4-6', effort: 'high' }));
  it('accepts plain legacy model ids', () => {
    expect(decodeClaudeVariant('sonnet')).toEqual({ model: 'sonnet' });
    expect(decodeClaudeVariant('claude-sonnet-4-6')).toEqual({ model: 'claude-sonnet-4-6' });
  });
  it('omits none effort', () => expect(decodeClaudeVariant('sonnet[effort=none]')).toEqual({ model: 'sonnet' }));
  it('rejects malformed and unknown variants', () => {
    expect(() => decodeClaudeVariant('sonnet[effort')).toThrow();
    expect(() => decodeClaudeVariant('sonnet[effort=ultra]')).toThrow();
  });
});
