import { describe, expect, it } from 'vitest';

import {
  isModelHidden,
  normalizeModelFilter,
  UNPREFIXED_PROVIDER_KEY,
  type ModelFilter,
} from './model-filter';

describe('isModelHidden', () => {
  it('hides only the individually listed model', () => {
    const filter: ModelFilter = { hiddenModels: ['openai/gpt-4'], hiddenProviders: [] };
    expect(isModelHidden('openai/gpt-4', filter)).toBe(true);
    expect(isModelHidden('openai/gpt-3.5', filter)).toBe(false);
  });

  it('does not hide variants when only the base model is individually hidden', () => {
    const filter: ModelFilter = {
      hiddenModels: ['anthropic/claude-sonnet-4-6'],
      hiddenProviders: [],
    };
    expect(isModelHidden('anthropic/claude-sonnet-4-6', filter)).toBe(true);
    expect(isModelHidden('anthropic/claude-sonnet-4-6[effort=high]', filter)).toBe(false);
  });

  it('hides every model under a hidden provider', () => {
    const filter: ModelFilter = { hiddenModels: [], hiddenProviders: ['openai'] };
    expect(isModelHidden('openai/gpt-4', filter)).toBe(true);
    expect(isModelHidden('openai/gpt-3.5', filter)).toBe(true);
    expect(isModelHidden('opencode/model-a', filter)).toBe(false);
  });

  it('treats hiddenModels under a hidden provider as exceptions', () => {
    const filter: ModelFilter = { hiddenModels: ['openai/gpt-4'], hiddenProviders: ['openai'] };
    expect(isModelHidden('openai/gpt-4', filter)).toBe(false);
    expect(isModelHidden('openai/gpt-3.5', filter)).toBe(true);
  });

  it('hides unprefixed models when the raw sentinel provider is hidden', () => {
    const filter: ModelFilter = { hiddenModels: [], hiddenProviders: [UNPREFIXED_PROVIDER_KEY] };
    expect(isModelHidden('composer-2.5', filter)).toBe(true);
    expect(isModelHidden('openai/gpt-4', filter)).toBe(false);
  });

  it('returns false for a missing filter', () => {
    expect(isModelHidden('openai/gpt-4', null)).toBe(false);
    expect(isModelHidden('openai/gpt-4', undefined)).toBe(false);
  });
});

describe('normalizeModelFilter', () => {
  it('drops the legacy unprefixed sentinel so the picker does not hide the bare bucket', () => {
    const normalized = normalizeModelFilter({
      hiddenModels: [],
      hiddenProviders: [UNPREFIXED_PROVIDER_KEY, 'openai'],
    });
    expect(normalized).toEqual({ hiddenModels: [], hiddenProviders: ['openai'] });
    expect(isModelHidden('composer-2.5', normalized)).toBe(false);
  });

  it('returns null for a missing filter', () => {
    expect(normalizeModelFilter(null)).toBeNull();
    expect(normalizeModelFilter(undefined)).toBeNull();
  });
});
