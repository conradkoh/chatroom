import { HARNESS_MODEL_CATALOG } from '@workspace/backend/src/domain/entities/harness/model-catalog';
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
    const groups = groupFlatModels([...models]);

    expect(groups).toHaveLength(2);

    const openai = groups.find((g) => g.providerKey === 'openai');
    expect(openai?.providerLabel).toBe('Openai');
    expect(openai?.options).toHaveLength(2);
    expect(openai?.options[0].value).toBe('openai/gpt-4o');
    // getModelDisplayLabel transforms "openai/gpt-4o" to "Openai / Gpt 4o"
    expect(openai?.options[0].label).toContain('Gpt 4o');
  });

  it('handles unprefixed models', () => {
    const models = ['gpt-4o', 'claude-3'];
    const groups = groupFlatModels(models);

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.providerKey)).toEqual(['gpt-4o', 'claude-3']);
    expect(groups[0].options).toHaveLength(1);
    expect(groups[1].options).toHaveLength(1);
  });

  it('groups variant models under base model provider key', () => {
    const models = ['sonnet', 'sonnet[effort=high]'];
    const groups = groupFlatModels(models);

    expect(groups).toHaveLength(1);
    expect(groups[0].providerKey).toBe('sonnet');
    expect(groups[0].options).toHaveLength(2);
    expect(groups[0].options[1].label).toBe('Sonnet [effort=high]');
  });

  it('groups claude catalog without duplicate base model provider keys', () => {
    const models = [...HARNESS_MODEL_CATALOG.claude];
    const groups = groupFlatModels(models);
    const keys = groups.map((g) => g.providerKey);
    expect(keys).toEqual([...new Set(keys)]);
    expect(keys).not.toContain('sonnet');
    expect(keys).not.toContain('haiku');
    expect(keys).not.toContain('opus');
  });

  it.each(['claude', 'claude-sdk'] as const)(
    'groups current Claude options from the %s catalog',
    (harness) => {
      const groups = groupFlatModels([...HARNESS_MODEL_CATALOG[harness]]);
      const options = groups.flatMap((group) => group.options);
      const models = [
        ['claude-opus-5-5', 'Claude Opus 5.5'],
        ['claude-haiku-5-5', 'Claude Haiku 5.5'],
        ['claude-sonnet-5-5', 'Claude Sonnet 5.5'],
        ['claude-mythos-5-1', 'Claude Mythos 5.1'],
        ['claude-mythos-5', 'Claude Mythos 5'],
      ] as const;

      for (const [model, expectedLabel] of models) {
        const base = options.find((option) => option.value === `anthropic/${model}`);
        const effort = options.find((option) => option.value === `anthropic/${model}[effort=high]`);

        expect(base?.label).toBe(`Anthropic / ${expectedLabel}`);
        expect(base?.value).toBe(`anthropic/${model}`);
        expect(effort?.label).toBe(`Anthropic / ${expectedLabel} [effort=high]`);
        expect(effort?.value).toBe(`anthropic/${model}[effort=high]`);
      }
    }
  );

  it('shows distinct labels for base model and effort=none variant', () => {
    const groups = groupFlatModels([
      'claude-opus-4-8',
      'claude-opus-4-8[effort=none]',
      'claude-opus-4-8[effort=high]',
    ]);
    const labels = groups.flatMap((group) => group.options.map((option) => option.label));
    expect(labels).toContain('Claude Opus 4.8');
    expect(labels).toContain('Claude Opus 4.8 [effort=none]');
    expect(labels).toContain('Claude Opus 4.8 [effort=high]');
    expect(new Set(labels).size).toBe(3);
  });

  it('returns empty array for empty input', () => {
    expect(groupFlatModels([])).toEqual([]);
  });

  it('keeps variant params uniform across a provider group', () => {
    const sharedParams = 'cyber=false,thinking=false,context=300k,effort=low,fast=false';
    const models = [
      `cursor/claude-opus-5[${sharedParams}]`,
      `cursor/claude-sonnet-4[${sharedParams}]`,
    ];
    const groups = groupFlatModels(models);
    const cursor = groups.find((g) => g.providerKey === 'cursor');
    expect(cursor?.options).toHaveLength(2);
    expect(cursor?.options[0].label).toContain(`[${sharedParams}]`);
    expect(cursor?.options[1].label).toContain(`[${sharedParams}]`);
  });

  it('keeps variant params that differ within a provider group', () => {
    const models = ['sonnet', 'sonnet[effort=high]'];
    const groups = groupFlatModels(models);
    expect(groups[0].options[0].label).toBe('Sonnet');
    expect(groups[0].options[1].label).toBe('Sonnet [effort=high]');
  });

  it('keeps surviving model variant tags after blacklist filtering', () => {
    const groups = groupFlatModels([
      'openai/gpt-5.6-luna[thinking=high]',
      'openai/gpt-5.5[thinking=high]',
    ]);

    const openai = groups.find((group) => group.providerKey === 'openai');
    const luna = openai?.options.find((option) => option.value.includes('gpt-5.6-luna'));

    expect(luna?.label).toContain('[thinking=high]');
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

  it('formats raw provider model names and preserves providerID::modelID values', () => {
    const anthropic: ProviderOption = {
      providerID: 'anthropic',
      name: 'Anthropic',
      models: [
        { modelID: 'claude-opus-5-5', name: 'anthropic/claude-opus-5-5' },
        {
          modelID: 'claude-haiku-5-5[effort=xhigh]',
          name: 'anthropic/claude-haiku-5-5[effort=xhigh]',
        },
      ],
    };
    const groups = groupProviderOptions([anthropic]);

    expect(groups[0].providerLabel).toBe('Anthropic');
    expect(groups[0].options).toEqual([
      { value: 'anthropic::claude-opus-5-5', label: 'Claude Opus 5.5' },
      {
        value: 'anthropic::claude-haiku-5-5[effort=xhigh]',
        label: 'Claude Haiku 5.5 [effort=xhigh]',
      },
    ]);
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

  it('does not double-prefix catalog models that already include provider', () => {
    const providers: ProviderOption[] = [
      {
        providerID: 'anthropic',
        name: 'Anthropic',
        models: [
          { modelID: 'anthropic/claude-sonnet-4-6', name: 'anthropic/claude-sonnet-4-6' },
          {
            modelID: 'anthropic/claude-sonnet-4-6[effort=high]',
            name: 'anthropic/claude-sonnet-4-6[effort=high]',
          },
        ],
      },
    ];

    expect(providerOptionsToFilterModelIds(providers)).toEqual([
      'anthropic/claude-sonnet-4-6',
      'anthropic/claude-sonnet-4-6[effort=high]',
    ]);
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
    const multiGroups = [
      {
        providerKey: 'openai',
        providerLabel: 'OpenAI',
        options: [
          { value: 'openai::gpt-4o', label: 'GPT-4o' },
          { value: 'openai::gpt-4-turbo', label: 'GPT-4 Turbo' },
        ],
      },
    ];
    expect(hasVisibleModels(multiGroups, (v) => v === 'openai::gpt-4o')).toBe(true);
  });

  it('returns false when all models are hidden', () => {
    expect(hasVisibleModels(groups, () => true)).toBe(false);
  });

  it('returns false for empty groups', () => {
    expect(hasVisibleModels([])).toBe(false);
  });
});
