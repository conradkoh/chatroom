import { describe, it, expect } from 'vitest';

import {
  titleCaseProvider,
  getProviderDisplayName,
  groupFlatModels,
  groupProviderOptions,
  providerOptionsToFilterModelIds,
  findModelLabel,
  hasVisibleModels,
} from './modelGroups';
import type { ProviderOption } from '../../direct-harness/components/harness-selectors/types';

describe('titleCaseProvider', () => {
  it('title-cases a single-word provider', () => {
    expect(titleCaseProvider('openai')).toBe('Openai');
  });

  it('title-cases a hyphenated provider', () => {
    expect(titleCaseProvider('github-copilot')).toBe('Github-Copilot');
  });

  it('handles empty string', () => {
    expect(titleCaseProvider('')).toBe('');
  });
});

describe('getProviderDisplayName', () => {
  it('returns "Models" for unprefixed provider', () => {
    expect(getProviderDisplayName('__unprefixed__')).toBe('Models');
  });

  it('title-cases normal provider keys', () => {
    expect(getProviderDisplayName('openai')).toBe('Openai');
  });
});

describe('groupFlatModels', () => {
  it('groups flat model IDs by provider key', () => {
    const models = ['openai/gpt-4o', 'openai/gpt-4-turbo', 'anthropic/claude-3'];
    const groups = groupFlatModels(models);

    expect(groups).toHaveLength(2);

    const openai = groups.find((g) => g.providerKey === 'openai');
    expect(openai?.providerLabel).toBe('Openai');
    expect(openai?.options).toHaveLength(2);
    expect(openai?.options[0].value).toBe('openai/gpt-4o');
    expect(openai?.options[0].label).toContain('GPT-4o');
  });

  it('handles unprefixed models', () => {
    const models = ['gpt-4o', 'claude-3'];
    const groups = groupFlatModels(models);

    expect(groups).toHaveLength(1);
    expect(groups[0].providerKey).toBe('__unprefixed__');
    expect(groups[0].providerLabel).toBe('Models');
    expect(groups[0].options).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(groupFlatModels([])).toEqual([]);
  });
});

describe('groupProviderOptions', () => {
  const providers: ProviderOption[] = [
    {
      providerID: 'openai',
      name: 'OpenAI',
      models: [
        { modelID: 'gpt-4o', name: 'GPT-4o' },
        { modelID: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
      ],
    },
    {
      providerID: 'opencode',
      name: 'OpenCode',
      models: [{ modelID: 'big-pickle', name: 'Big Pickle' }],
    },
  ];

  it('groups ProviderOption[] into ModelGroups', () => {
    const groups = groupProviderOptions(providers);

    expect(groups).toHaveLength(2);

    const openai = groups.find((g) => g.providerKey === 'openai');
    expect(openai?.providerLabel).toBe('OpenAI');
    expect(openai?.options).toHaveLength(2);
    expect(openai?.options[0].value).toBe('openai::gpt-4o');
    expect(openai?.options[0].label).toBe('GPT-4o');

    const opencode = groups.find((g) => g.providerKey === 'opencode');
    expect(opencode?.options).toHaveLength(1);
    expect(opencode?.options[0].value).toBe('opencode::big-pickle');
  });

  it('uses custom modelKey and modelLabel options', () => {
    const groups = groupProviderOptions(providers, {
      modelKey: (p, m) => `${p}/${m}`,
      modelLabel: (_p, m) => m.name.toUpperCase(),
    });

    expect(groups[0].options[0].value).toBe('openai/gpt-4o');
    expect(groups[0].options[0].label).toBe('GPT-4O');
  });

  it('returns empty array for empty providers', () => {
    expect(groupProviderOptions([])).toEqual([]);
  });
});

describe('providerOptionsToFilterModelIds', () => {
  it('flattens providers to providerID/modelID format', () => {
    const providers: ProviderOption[] = [
      {
        providerID: 'openai',
        name: 'OpenAI',
        models: [
          { modelID: 'gpt-4o', name: 'GPT-4o' },
          { modelID: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
        ],
      },
    ];

    expect(providerOptionsToFilterModelIds(providers)).toEqual([
      'openai/gpt-4o',
      'openai/gpt-4-turbo',
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(providerOptionsToFilterModelIds([])).toEqual([]);
  });
});

describe('findModelLabel', () => {
  const groups = [
    {
      providerKey: 'openai',
      providerLabel: 'OpenAI',
      options: [{ value: 'openai::gpt-4o', label: 'GPT-4o' }],
    },
  ];

  it('finds label for existing value', () => {
    expect(findModelLabel(groups, 'openai::gpt-4o')).toBe('GPT-4o');
  });

  it('returns undefined for missing value', () => {
    expect(findModelLabel(groups, 'missing')).toBeUndefined();
  });

  it('returns undefined for empty value', () => {
    expect(findModelLabel(groups, '')).toBeUndefined();
  });
});

describe('hasVisibleModels', () => {
  const groups = [
    {
      providerKey: 'openai',
      providerLabel: 'OpenAI',
      options: [{ value: 'openai::gpt-4o', label: 'GPT-4o' }],
    },
  ];

  it('returns true when no isHidden filter', () => {
    expect(hasVisibleModels(groups)).toBe(true);
  });

  it('returns true when at least one model is visible', () => {
    expect(hasVisibleModels(groups, (v) => v !== 'openai::gpt-4o')).toBe(false);
  });

  it('returns false when all models are hidden', () => {
    expect(hasVisibleModels(groups, () => true)).toBe(false);
  });

  it('returns false for empty groups', () => {
    expect(hasVisibleModels([])).toBe(false);
  });
});
