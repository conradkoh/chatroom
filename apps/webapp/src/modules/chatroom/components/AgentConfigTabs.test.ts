import { describe, expect, it } from 'vitest';

import { isModelHidden } from './AgentConfigTabs';

describe('isModelHidden', () => {
  describe('when filter is null or undefined', () => {
    it('returns false for null filter', () => {
      expect(isModelHidden('openai/gpt-4o', null)).toBe(false);
    });

    it('returns false for undefined filter', () => {
      expect(isModelHidden('openai/gpt-4o', undefined)).toBe(false);
    });
  });

  describe('when filter has no hidden providers or models', () => {
    it('returns false for any model', () => {
      const filter = { hiddenModels: [], hiddenProviders: [] };
      expect(isModelHidden('openai/gpt-4o', filter)).toBe(false);
      expect(isModelHidden('anthropic/claude-3', filter)).toBe(false);
    });
  });

  describe('individual model hiding (provider visible)', () => {
    it('hides a model when it is in hiddenModels', () => {
      const filter = {
        hiddenModels: ['openai/gpt-4o'],
        hiddenProviders: [],
      };
      expect(isModelHidden('openai/gpt-4o', filter)).toBe(true);
    });

    it('does not hide models not in hiddenModels', () => {
      const filter = {
        hiddenModels: ['openai/gpt-4o'],
        hiddenProviders: [],
      };
      expect(isModelHidden('openai/gpt-4-turbo', filter)).toBe(false);
      expect(isModelHidden('anthropic/claude-3', filter)).toBe(false);
    });

    it('can hide multiple models individually', () => {
      const filter = {
        hiddenModels: ['openai/gpt-4o', 'anthropic/claude-3'],
        hiddenProviders: [],
      };
      expect(isModelHidden('openai/gpt-4o', filter)).toBe(true);
      expect(isModelHidden('anthropic/claude-3', filter)).toBe(true);
      expect(isModelHidden('openai/gpt-3.5', filter)).toBe(false);
    });
  });

  describe('provider-level hiding', () => {
    it('hides all models from a hidden provider', () => {
      const filter = {
        hiddenModels: [],
        hiddenProviders: ['openai'],
      };
      expect(isModelHidden('openai/gpt-4o', filter)).toBe(true);
      expect(isModelHidden('openai/gpt-3.5', filter)).toBe(true);
    });

    it('does not hide models from non-hidden providers', () => {
      const filter = {
        hiddenModels: [],
        hiddenProviders: ['openai'],
      };
      expect(isModelHidden('anthropic/claude-3', filter)).toBe(false);
    });
  });

  describe('provider-level hiding with model overrides (exceptions)', () => {
    it('un-hides a specific model when its provider is hidden', () => {
      const filter = {
        hiddenModels: ['openai/gpt-4o'],
        hiddenProviders: ['openai'],
      };
      // Provider hidden, but gpt-4o is in hiddenModels → exception → NOT hidden
      expect(isModelHidden('openai/gpt-4o', filter)).toBe(false);
      // Other openai models remain hidden
      expect(isModelHidden('openai/gpt-3.5', filter)).toBe(true);
    });

    it('un-hides multiple exceptions within a hidden provider', () => {
      const filter = {
        hiddenModels: ['openai/gpt-4o', 'openai/gpt-4-turbo'],
        hiddenProviders: ['openai'],
      };
      expect(isModelHidden('openai/gpt-4o', filter)).toBe(false);
      expect(isModelHidden('openai/gpt-4-turbo', filter)).toBe(false);
      expect(isModelHidden('openai/gpt-3.5', filter)).toBe(true);
    });
  });

  describe('models without provider prefix', () => {
    it('treats the full model ID as the provider when no slash present', () => {
      const filter = {
        hiddenModels: ['gpt-4o'],
        hiddenProviders: [],
      };
      expect(isModelHidden('gpt-4o', filter)).toBe(true);
    });

    it('hides all models under a provider prefix that matches the full ID', () => {
      const filter = {
        hiddenModels: [],
        hiddenProviders: ['gpt-4o'],
      };
      // "gpt-4o".split('/')[0] === "gpt-4o" which matches the provider
      expect(isModelHidden('gpt-4o', filter)).toBe(true);
    });
  });

  describe('filtering a model list', () => {
    const allModels = [
      'openai/gpt-4o',
      'openai/gpt-3.5',
      'anthropic/claude-3',
      'anthropic/claude-2',
      'google/gemini-pro',
    ];

    it('filters out hidden models from a list', () => {
      const filter = {
        hiddenModels: ['openai/gpt-4o', 'anthropic/claude-2'],
        hiddenProviders: [],
      };
      const visible = allModels.filter((m) => !isModelHidden(m, filter));
      expect(visible).toEqual([
        'openai/gpt-3.5',
        'anthropic/claude-3',
        'google/gemini-pro',
      ]);
    });

    it('filters out entire providers from a list', () => {
      const filter = {
        hiddenModels: [],
        hiddenProviders: ['openai'],
      };
      const visible = allModels.filter((m) => !isModelHidden(m, filter));
      expect(visible).toEqual([
        'anthropic/claude-3',
        'anthropic/claude-2',
        'google/gemini-pro',
      ]);
    });

    it('filters provider with exceptions applied correctly', () => {
      const filter = {
        hiddenModels: ['openai/gpt-4o'],
        hiddenProviders: ['openai'],
      };
      const visible = allModels.filter((m) => !isModelHidden(m, filter));
      // openai provider hidden, but gpt-4o is an exception (un-hidden)
      expect(visible).toEqual([
        'openai/gpt-4o',
        'anthropic/claude-3',
        'anthropic/claude-2',
        'google/gemini-pro',
      ]);
    });

    it('returns all models when filter is null', () => {
      const visible = allModels.filter((m) => !isModelHidden(m, null));
      expect(visible).toEqual(allModels);
    });
  });
});
