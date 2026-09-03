import { describe, expect, it } from 'vitest';

import {
  expandOpencodeModelVariants,
  expandOpencodeProviderCatalog,
  opencodeModelDisplayName,
} from './opencode-model-catalog.js';

describe('expandOpencodeModelVariants', () => {
  it('returns the base model when variants are absent', () => {
    expect(expandOpencodeModelVariants('openai/gpt-4o')).toEqual(['openai/gpt-4o']);
  });

  it('expands tagged variants and keeps the base model first when default exists', () => {
    expect(
      expandOpencodeModelVariants('gpt-5.6-luna', {
        max: {},
        default: {},
      })
    ).toEqual(['gpt-5.6-luna', 'gpt-5.6-luna[variant=max]']);
  });

  it('places the plain model first when the default tag is first', () => {
    expect(
      expandOpencodeModelVariants('gpt-5.6-luna', {
        default: {},
        max: {},
      })
    ).toEqual(['gpt-5.6-luna', 'gpt-5.6-luna[variant=max]']);
  });

  it('skips disabled variants', () => {
    expect(
      expandOpencodeModelVariants('gpt-5.6-luna', {
        max: { disabled: true },
        default: {},
      })
    ).toEqual(['gpt-5.6-luna']);
  });
});

describe('expandOpencodeProviderCatalog', () => {
  it('prefixes connected providers, expands variants, and deduplicates entries', () => {
    expect(
      expandOpencodeProviderCatalog(
        [
          {
            id: 'openai',
            name: 'OpenAI',
            models: {
              key: { id: 'gpt-5.6-luna', name: 'GPT 5.6 Luna', variants: { default: {}, max: {} } },
            },
          },
          {
            id: 'disconnected',
            name: 'Disconnected',
            models: { other: { id: 'other', name: 'Other' } },
          },
        ],
        new Set(['openai'])
      )
    ).toEqual(['openai/gpt-5.6-luna', 'openai/gpt-5.6-luna[variant=max]']);
  });
});

describe('opencodeModelDisplayName', () => {
  it('adds the variant tag to the base display name', () => {
    const model = { id: 'gpt-5.6-luna', name: 'GPT 5.6 Luna' };
    expect(opencodeModelDisplayName(model, 'gpt-5.6-luna[variant=max]')).toBe('GPT 5.6 Luna (max)');
    expect(opencodeModelDisplayName(model, 'gpt-5.6-luna')).toBe('GPT 5.6 Luna');
  });
});
