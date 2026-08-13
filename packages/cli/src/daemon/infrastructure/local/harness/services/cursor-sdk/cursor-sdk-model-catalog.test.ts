import type { ModelListItem } from '@cursor/sdk';
import { describe, expect, it } from 'vitest';

import {
  cursorCatalogBaseId,
  cursorSdkBaseId,
  expandCursorSdkModelCatalog,
} from './cursor-sdk-model-catalog.js';

const FIXTURE: ModelListItem[] = [
  {
    id: 'default',
    displayName: 'Auto',
    variants: [{ params: [], displayName: 'Auto', isDefault: true }],
  },
  {
    id: 'gpt-5.6-terra',
    displayName: 'GPT 5.6 Terra',
    variants: [
      { params: [], displayName: 'Default', isDefault: true },
      { params: [{ id: 'effort', value: 'high' }], displayName: 'High' },
      { params: [{ id: 'effort', value: 'low' }, { id: 'fast', value: 'enabled' }], displayName: 'Low Fast' },
    ],
  },
  {
    id: 'gpt-5.6-luna',
    displayName: 'GPT 5.6 Luna',
    variants: [
      { params: [{ id: 'effort', value: 'medium' }], displayName: 'Medium' },
      { params: [{ id: 'effort', value: 'high' }], displayName: 'High', isDefault: true },
    ],
  },
  {
    id: 'composer-2.5',
    displayName: 'Composer 2.5',
  },
];

describe('cursorCatalogBaseId / cursorSdkBaseId', () => {
  it('maps default ↔ auto', () => {
    expect(cursorCatalogBaseId('default')).toBe('auto');
    expect(cursorSdkBaseId('auto')).toBe('default');
  });

  it('passes through other ids', () => {
    expect(cursorCatalogBaseId('gpt-5.6-terra')).toBe('gpt-5.6-terra');
    expect(cursorSdkBaseId('gpt-5.6-terra')).toBe('gpt-5.6-terra');
  });
});

describe('expandCursorSdkModelCatalog', () => {
  it('expands SDK models including GPT 5.6 variants', () => {
    const catalog = expandCursorSdkModelCatalog(FIXTURE);
    expect(catalog).toContain('auto');
    expect(catalog).toContain('gpt-5.6-terra');
    expect(catalog).toContain('gpt-5.6-terra[effort=high]');
    expect(catalog).toContain('gpt-5.6-terra[effort=low,fast=enabled]');
    expect(catalog).toContain('gpt-5.6-luna[effort=high]');
    expect(catalog).toContain('gpt-5.6-luna[effort=medium]');
    expect(catalog).toContain('composer-2.5');
  });

  it('deduplicates entries preserving first-seen order', () => {
    const models: ModelListItem[] = [
      {
        id: 'gpt-5.4',
        displayName: 'GPT 5.4',
        variants: [
          { params: [], displayName: 'Default', isDefault: true },
          { params: [], displayName: 'Default again' },
        ],
      },
    ];
    const catalog = expandCursorSdkModelCatalog(models);
    expect(catalog.filter((e) => e === 'gpt-5.4')).toHaveLength(1);
  });
});
