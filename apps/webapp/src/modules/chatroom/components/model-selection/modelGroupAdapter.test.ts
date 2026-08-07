import { describe, it, expect } from 'vitest';

import {
  adaptProviderGroupsToModelGroups,
  aggregateFlatModelsByProvider,
} from './modelGroupAdapter';

describe('adaptProviderGroupsToModelGroups', () => {
  it('passes through provider groups as ModelGroup[]', () => {
    const result = adaptProviderGroupsToModelGroups([
      {
        providerKey: 'openai',
        providerLabel: 'OpenAI',
        options: [{ value: 'gpt-4o', label: 'GPT-4o' }],
      },
    ]);
    expect(result).toEqual([
      {
        providerKey: 'openai',
        providerLabel: 'OpenAI',
        options: [{ value: 'gpt-4o', label: 'GPT-4o' }],
      },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(adaptProviderGroupsToModelGroups([])).toEqual([]);
  });
});

describe('aggregateFlatModelsByProvider', () => {
  it('aggregates multiple models under the same provider', () => {
    const result = aggregateFlatModelsByProvider([
      { providerKey: 'openai', providerLabel: 'Openai', value: 'openai/gpt-4o', label: 'GPT 4O' },
      {
        providerKey: 'openai',
        providerLabel: 'Openai',
        value: 'openai/gpt-4-turbo',
        label: 'GPT 4 TURBO',
      },
      {
        providerKey: 'anthropic',
        providerLabel: 'Anthropic',
        value: 'anthropic/claude-3',
        label: 'CLAUDE 3',
      },
    ]);
    expect(result).toHaveLength(2);
    const openai = result.find((g) => g.providerKey === 'openai');
    expect(openai?.options).toHaveLength(2);
    expect(openai?.options.map((o) => o.value)).toEqual(['openai/gpt-4o', 'openai/gpt-4-turbo']);
    const anthropic = result.find((g) => g.providerKey === 'anthropic');
    expect(anthropic?.options).toHaveLength(1);
  });

  it('returns empty array for empty input', () => {
    expect(aggregateFlatModelsByProvider([])).toEqual([]);
  });
});
