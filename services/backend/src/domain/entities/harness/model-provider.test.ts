import { describe, expect, it } from 'vitest';

import {
  migrateFavoriteModelForHarness,
  prefixCatalogModels,
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

  it('prefixes catalog collections', () => {
    expect(prefixCatalogModels('anthropic', ['a', 'b[x=y]'])).toEqual([
      'anthropic/a',
      'anthropic/b[x=y]',
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
    expect(migrateFavoriteModelForHarness('cursor-sdk', 'cursor/composer-1')).toBe(
      'cursor/composer-1'
    );
    expect(migrateFavoriteModelForHarness('cursor-sdk', 'composer-1[reasoning=high]')).toBe(
      'cursor/composer-1[reasoning=high]'
    );
    expect(migrateFavoriteModelForHarness('opencode-sdk', 'custom-model')).toBe('custom-model');
  });
});
