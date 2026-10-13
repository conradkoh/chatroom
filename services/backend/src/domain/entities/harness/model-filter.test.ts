import { describe, expect, it } from 'vitest';

import {
  isModelHidden,
  normalizeModelFilter,
  pruneHiddenFavorites,
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

describe('pruneHiddenFavorites', () => {
  it('removes a favourite whose individual model is hidden for the same harness', () => {
    const favorites = [
      { agentHarness: 'opencode', model: 'openai/gpt-4' },
      { agentHarness: 'opencode', model: 'openai/gpt-3.5' },
    ];
    const filter: ModelFilter = { hiddenModels: ['openai/gpt-4'], hiddenProviders: [] };
    expect(pruneHiddenFavorites(favorites, 'opencode', filter)).toEqual([
      { agentHarness: 'opencode', model: 'openai/gpt-3.5' },
    ]);
  });

  it('removes every favourite under a hidden provider for the same harness', () => {
    const favorites = [
      { agentHarness: 'opencode', model: 'openai/gpt-4' },
      { agentHarness: 'opencode', model: 'openai/gpt-3.5' },
      { agentHarness: 'opencode', model: 'anthropic/claude' },
    ];
    const filter: ModelFilter = { hiddenModels: [], hiddenProviders: ['openai'] };
    expect(pruneHiddenFavorites(favorites, 'opencode', filter)).toEqual([
      { agentHarness: 'opencode', model: 'anthropic/claude' },
    ]);
  });

  it('keeps a favourite for a different harness even when the model is hidden', () => {
    const favorites = [{ agentHarness: 'cursor-sdk', model: 'openai/gpt-4' }];
    const filter: ModelFilter = { hiddenModels: ['openai/gpt-4'], hiddenProviders: [] };
    expect(pruneHiddenFavorites(favorites, 'opencode', filter)).toBe(favorites);
  });

  it('keeps a visible favourite and preserves the order of the remaining entries', () => {
    const favorites = [
      { agentHarness: 'opencode', model: 'anthropic/claude' },
      { agentHarness: 'opencode', model: 'openai/gpt-4' },
      { agentHarness: 'opencode', model: 'google/gemini' },
    ];
    const filter: ModelFilter = { hiddenModels: ['openai/gpt-4'], hiddenProviders: [] };
    expect(pruneHiddenFavorites(favorites, 'opencode', filter).map((f) => f.model)).toEqual([
      'anthropic/claude',
      'google/gemini',
    ]);
  });

  it('returns the same array instance when nothing is removed', () => {
    const favorites = [{ agentHarness: 'opencode', model: 'anthropic/claude' }];
    const filter: ModelFilter = { hiddenModels: ['openai/gpt-4'], hiddenProviders: [] };
    expect(pruneHiddenFavorites(favorites, 'opencode', filter)).toBe(favorites);
  });

  it('keeps an empty favourites list as the same empty instance', () => {
    const favorites: { agentHarness: string; model: string }[] = [];
    const filter: ModelFilter = { hiddenModels: ['openai/gpt-4'], hiddenProviders: [] };
    expect(pruneHiddenFavorites(favorites, 'opencode', filter)).toBe(favorites);
  });

  it('removes a favourite whose :: model key is hidden after normalization', () => {
    const favorites = [{ agentHarness: 'opencode', model: 'openai::gpt-4' }];
    const filter: ModelFilter = { hiddenModels: ['openai/gpt-4'], hiddenProviders: [] };
    expect(pruneHiddenFavorites(favorites, 'opencode', filter)).toEqual([]);
  });

  it('keeps a favourite under the legacy unprefixed sentinel, which the picker never hides', () => {
    const favorites = [{ agentHarness: 'opencode', model: 'composer-2.5' }];
    const filter: ModelFilter = { hiddenModels: [], hiddenProviders: [UNPREFIXED_PROVIDER_KEY] };
    expect(pruneHiddenFavorites(favorites, 'opencode', filter)).toBe(favorites);
  });

  it('keeps the favourite when a provider is hidden but the model is an exception', () => {
    const favorites = [{ agentHarness: 'opencode', model: 'openai/gpt-4' }];
    const filter: ModelFilter = { hiddenModels: ['openai/gpt-4'], hiddenProviders: ['openai'] };
    expect(pruneHiddenFavorites(favorites, 'opencode', filter)).toBe(favorites);
  });
});
