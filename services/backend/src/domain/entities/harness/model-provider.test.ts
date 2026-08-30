import { describe, expect, it } from 'vitest';

import {
  inferCommandCodeModelProvider,
  inferCopilotModelProvider,
  migrateFavoriteModelForHarness,
  prefixCatalogModels,
  prefixCatalogModelsWithInfer,
  prefixModelWithProvider,
  stripProviderPrefix,
} from './model-provider';

describe('model provider helpers', () => {
  it('prefixes bare ids and preserves variants idempotently', () => {
    expect(prefixModelWithProvider('openai', 'gpt-5[reasoning=high]')).toBe(
      'openai/gpt-5[reasoning=high]'
    );
    expect(prefixModelWithProvider('openai', 'openai/gpt-5[reasoning=high]')).toBe(
      'openai/gpt-5[reasoning=high]'
    );
  });
  it('strips only the requested provider prefix', () => {
    expect(stripProviderPrefix('openai', 'openai/gpt-5')).toBe('gpt-5');
    expect(stripProviderPrefix('openai', 'gpt-5')).toBe('gpt-5');
  });
  it('infers copilot and commandcode providers', () => {
    expect(inferCopilotModelProvider('claude-sonnet-4-6')).toBe('anthropic');
    expect(inferCopilotModelProvider('gpt-4o')).toBe('openai');
    expect(inferCopilotModelProvider('gemini-2-5-flash')).toBe('google');
    expect(inferCopilotModelProvider('other')).toBe('github-copilot');
    expect(inferCommandCodeModelProvider('claude-sonnet')).toBe('anthropic');
    expect(inferCommandCodeModelProvider('gpt-5')).toBe('openai');
    expect(inferCommandCodeModelProvider('other')).toBe('commandcode');
  });
  it('prefixes catalog collections', () => {
    expect(prefixCatalogModels('cursor', ['a', 'b[x=y]'])).toEqual(['cursor/a', 'cursor/b[x=y]']);
    expect(prefixCatalogModelsWithInfer(inferCopilotModelProvider, ['gpt-4o'])).toEqual([
      'openai/gpt-4o',
    ]);
  });

  it('migrates favorite model ids by harness', () => {
    expect(migrateFavoriteModelForHarness('cursor-sdk', 'composer-1')).toBe('cursor/composer-1');
    expect(migrateFavoriteModelForHarness('claude-sdk', 'claude-sonnet-4-6')).toBe(
      'anthropic/claude-sonnet-4-6'
    );
    expect(migrateFavoriteModelForHarness('codex-sdk', 'gpt-5.6-terra')).toBe(
      'openai/gpt-5.6-terra'
    );
    expect(migrateFavoriteModelForHarness('copilot', 'claude-sonnet-4-6')).toBe(
      'anthropic/claude-sonnet-4-6'
    );
    expect(migrateFavoriteModelForHarness('commandcode', 'gpt-5')).toBe('openai/gpt-5');
    expect(migrateFavoriteModelForHarness('cursor', 'cursor/composer-1')).toBe('cursor/composer-1');
    expect(migrateFavoriteModelForHarness('cursor', 'composer-1[reasoning=high]')).toBe(
      'cursor/composer-1[reasoning=high]'
    );
    expect(migrateFavoriteModelForHarness('opencode', 'custom-model')).toBe('custom-model');
  });
});
