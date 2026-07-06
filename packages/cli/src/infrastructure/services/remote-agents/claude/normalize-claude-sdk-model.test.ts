import { describe, expect, it } from 'vitest';

import { normalizeClaudeSdkModelFor200k } from './normalize-claude-sdk-model.js';

describe('normalizeClaudeSdkModelFor200k', () => {
  it('strips [1m] suffix from model id', () => {
    expect(normalizeClaudeSdkModelFor200k('claude-opus-4-6[1m]')).toBe('claude-opus-4-6');
  });

  it('strips case-insensitive [1M] suffix', () => {
    expect(normalizeClaudeSdkModelFor200k('claude-sonnet-4-6[1M]')).toBe('claude-sonnet-4-6');
  });

  it('passes through normal model ids unchanged', () => {
    expect(normalizeClaudeSdkModelFor200k('claude-sonnet-4-20250514')).toBe(
      'claude-sonnet-4-20250514'
    );
  });

  it('returns undefined for undefined input', () => {
    expect(normalizeClaudeSdkModelFor200k(undefined)).toBeUndefined();
  });
});
