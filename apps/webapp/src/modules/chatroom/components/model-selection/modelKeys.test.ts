import { describe, it, expect } from 'vitest';

import { getProviderModelLabel, harnessModelKey, getHarnessModelLabel } from './modelKeys';
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

  it('formats raw Claude names while keeping provider and key semantics', () => {
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

    expect(getHarnessModelLabel([anthropic], 'anthropic::claude-opus-5-5')).toBe(
      'Anthropic / Claude Opus 5.5'
    );
    expect(getHarnessModelLabel([anthropic], 'anthropic::claude-haiku-5-5[effort=xhigh]')).toBe(
      'Anthropic / Claude Haiku 5.5 [effort=xhigh]'
    );
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

describe('getProviderModelLabel', () => {
  it.each([
    [
      { providerID: 'anthropic' },
      { modelID: 'claude-opus-5-5', name: 'anthropic/claude-opus-5-5' },
      'Claude Opus 5.5',
    ],
    [
      { providerID: 'anthropic' },
      { modelID: 'claude-sonnet-5-5', name: 'claude-sonnet-5-5' },
      'Claude Sonnet 5.5',
    ],
    [
      { providerID: 'anthropic' },
      {
        modelID: 'claude-haiku-5-5[effort=xhigh]',
        name: 'anthropic/claude-haiku-5-5[effort=xhigh]',
      },
      'Claude Haiku 5.5 [effort=xhigh]',
    ],
    [
      { providerID: 'anthropic' },
      { modelID: 'anthropic/claude-mythos-5-1', name: 'anthropic/claude-mythos-5-1' },
      'Claude Mythos 5.1',
    ],
    [
      { providerID: 'anthropic' },
      {
        modelID: 'claude-haiku-4-5-2025-10-01',
        name: 'anthropic/claude-haiku-4-5-2025-10-01',
      },
      'Claude Haiku 4.5 2025 10 01',
    ],
    [
      { providerID: 'anthropic' },
      { modelID: 'claude-opus-4.8', name: 'anthropic/claude-opus-4.8' },
      'Claude Opus 4.8',
    ],
    [
      { providerID: 'anthropic' },
      { modelID: 'claude-haiku-5-5', name: 'Claude Haiku 5 5' },
      'Claude Haiku 5.5',
    ],
    [
      { providerID: 'anthropic' },
      {
        modelID: 'claude-haiku-5-5[effort=xhigh]',
        name: 'Claude Haiku 5 5 [effort=xhigh]',
      },
      'Claude Haiku 5.5 [effort=xhigh]',
    ],
    [
      { providerID: 'anthropic' },
      {
        modelID: 'claude-haiku-5-5[effort=xhigh]',
        name: 'anthropic/claude-haiku-5-5[effort=xhigh]',
      },
      'Claude Haiku 5.5 [effort=xhigh]',
    ],
    [
      { providerID: 'anthropic' },
      { modelID: 'claude-haiku-5-5', name: 'Claude Haiku (Preview)' },
      'Claude Haiku (Preview)',
    ],
    [{ providerID: 'openai' }, { modelID: 'gpt-4o', name: 'GPT-4o' }, 'GPT-4o'],
    [{ providerID: 'openai' }, { modelID: 'gpt-4o', name: 'GPT 4o Mini' }, 'GPT 4o Mini'],
    [{ providerID: 'meta' }, { modelID: 'llama-3-1-70b', name: 'Llama 3 70 B' }, 'Llama 3 70 B'],
    [{ providerID: 'opencode' }, { modelID: 'big-pickle', name: 'Big Pickle' }, 'Big Pickle'],
  ] as const)('formats raw names or preserves friendly names: %s', (provider, model, expected) => {
    expect(getProviderModelLabel(provider, model)).toBe(expected);
  });
});
