import { describe, it, expect } from 'vitest';

import { harnessModelKey, getHarnessModelLabel } from './modelKeys';
import type { ProviderOption } from '../../direct-harness/components/harness-selectors/types';

describe('harnessModelKey', () => {
  it('joins providerID and modelID with ::', () => {
    expect(harnessModelKey('openai', 'gpt-4o')).toBe('openai::gpt-4o');
  });
});

describe('getHarnessModelLabel', () => {
  const providers: ProviderOption[] = [
    {
      providerID: 'openai',
      name: 'OpenAI',
      models: [{ modelID: 'gpt-4o', name: 'GPT-4o' }],
    },
  ];

  it('returns formatted label for a valid key', () => {
    expect(getHarnessModelLabel(providers, 'openai::gpt-4o')).toBe('OpenAI / GPT-4o');
  });

  it('returns null for empty value', () => {
    expect(getHarnessModelLabel(providers, '')).toBeNull();
  });

  it('returns null for unknown provider', () => {
    expect(getHarnessModelLabel(providers, 'unknown::model')).toBeNull();
  });

  it('returns null for unknown model', () => {
    expect(getHarnessModelLabel(providers, 'openai::unknown')).toBeNull();
  });
});
