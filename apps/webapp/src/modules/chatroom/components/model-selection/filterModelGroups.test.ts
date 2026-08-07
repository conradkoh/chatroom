import { describe, expect, it } from 'vitest';

import { filterModelGroups } from './filterModelGroups';
import type { ModelGroup } from './types';

const GROUPS: ModelGroup[] = [
  {
    providerKey: 'openai',
    providerLabel: 'OpenAI',
    options: [
      { value: 'openai/gpt-4o', label: 'GPT-4o' },
      { value: 'openai/gpt-4-turbo', label: 'GPT-4 Turbo' },
    ],
  },
  {
    providerKey: 'anthropic',
    providerLabel: 'Anthropic',
    options: [{ value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' }],
  },
];

describe('filterModelGroups', () => {
  it('returns all groups when search is empty', () => {
    expect(filterModelGroups(GROUPS, '')).toEqual(GROUPS);
  });

  it('filters options by label, provider, and value', () => {
    expect(filterModelGroups(GROUPS, 'sonnet')).toEqual([
      {
        providerKey: 'anthropic',
        providerLabel: 'Anthropic',
        options: [{ value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' }],
      },
    ]);
  });

  it('excludes hidden models before searching', () => {
    const isHidden = (value: string) => value === 'openai/gpt-4-turbo';
    expect(filterModelGroups(GROUPS, '', { isHidden })).toEqual([
      {
        providerKey: 'openai',
        providerLabel: 'OpenAI',
        options: [{ value: 'openai/gpt-4o', label: 'GPT-4o' }],
      },
      GROUPS[1],
    ]);
  });
});
