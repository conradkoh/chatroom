import type { ModelInfo } from '@opencode/client';
import { describe, expect, it } from 'vitest';

import {
  expandOpencodeModelVariants,
  expandOpencodeProviderCatalog,
  opencodeModelDisplayName,
} from './opencode-model-catalog.js';

function model(partial: {
  providerID: string;
  modelID: string;
  name?: string;
  enabled?: boolean;
  variants?: { id: string }[];
}): ModelInfo {
  return {
    id: partial.modelID,
    modelID: partial.modelID,
    providerID: partial.providerID,
    name: partial.name ?? partial.modelID,
    variants: partial.variants ?? [],
    enabled: partial.enabled ?? true,
  } as unknown as ModelInfo;
}

describe('expandOpencodeModelVariants', () => {
  it('returns the base model when variants are absent', () => {
    expect(expandOpencodeModelVariants('gpt-5.6-luna')).toEqual(['gpt-5.6-luna']);
  });

  it('keeps the base model first and encodes meaningful variants', () => {
    expect(expandOpencodeModelVariants('gpt-5.6-luna', [{ id: 'max' }, { id: 'default' }])).toEqual(
      ['gpt-5.6-luna', 'gpt-5.6-luna[variant=max]']
    );
  });

  it('treats "none" as the unparameterized model', () => {
    expect(expandOpencodeModelVariants('gpt-5.6-luna', [{ id: 'none' }, { id: 'high' }])).toEqual([
      'gpt-5.6-luna',
      'gpt-5.6-luna[variant=high]',
    ]);
  });
});

describe('expandOpencodeProviderCatalog', () => {
  it('prefixes providers, expands variants, skips disabled models, and deduplicates', () => {
    expect(
      expandOpencodeProviderCatalog([
        model({
          providerID: 'openai',
          modelID: 'gpt-5.6-luna',
          name: 'GPT 5.6 Luna',
          variants: [{ id: 'default' }, { id: 'max' }],
        }),
        model({ providerID: 'openai', modelID: 'other', name: 'Other' }),
        model({
          providerID: 'openai',
          modelID: 'disabled-model',
          name: 'Disabled',
          enabled: false,
          variants: [{ id: 'high' }],
        }),
      ])
    ).toEqual(['openai/gpt-5.6-luna', 'openai/gpt-5.6-luna[variant=max]', 'openai/other']);
  });
});

describe('opencodeModelDisplayName', () => {
  it('adds the variant tag to the base display name', () => {
    const m = { name: 'GPT 5.6 Luna' };
    expect(opencodeModelDisplayName(m, 'gpt-5.6-luna[variant=max]')).toBe('GPT 5.6 Luna (max)');
    expect(opencodeModelDisplayName(m, 'gpt-5.6-luna')).toBe('GPT 5.6 Luna');
  });
});
