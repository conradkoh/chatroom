import { describe, expect, it } from 'vitest';

import {
  inferCommandCodeModelProvider,
  inferCopilotModelProvider,
  prefixCatalogModels,
  prefixCatalogModelsWithInfer,
  prefixModelWithProvider,
  stripProviderPrefix,
} from './model-provider';

describe('model provider helpers', () => {
  it('prefixes bare ids and preserves variants idempotently', () => {
    expect(prefixModelWithProvider('openai', 'gpt-5[reasoning=high]')).toBe('openai/gpt-5[reasoning=high]');
    expect(prefixModelWithProvider('openai', 'openai/gpt-5[reasoning=high]')).toBe('openai/gpt-5[reasoning=high]');
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
    expect(prefixCatalogModelsWithInfer(inferCopilotModelProvider, ['gpt-4o'])).toEqual(['openai/gpt-4o']);
  });
});
