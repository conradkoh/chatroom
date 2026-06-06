import { describe, expect, it } from 'vitest';

import { normalizeCursorSdkListedModels, resolveCursorSdkModel } from './cursor-models.js';

describe('resolveCursorSdkModel', () => {
  it('strips cursor/ prefix for SDK', () => {
    expect(resolveCursorSdkModel('cursor/composer-2.5')).toBe('composer-2.5');
  });

  it('maps default to auto for SDK calls', () => {
    expect(resolveCursorSdkModel('default')).toBe('auto');
    expect(resolveCursorSdkModel('cursor/default')).toBe('auto');
  });

  it('passes through auto', () => {
    expect(resolveCursorSdkModel('auto')).toBe('auto');
  });
});

describe('normalizeCursorSdkListedModels', () => {
  it('maps default to auto for daemon model discovery', () => {
    expect(normalizeCursorSdkListedModels(['default', 'composer-2.5'])).toEqual([
      'auto',
      'composer-2.5',
    ]);
  });

  it('dedupes when API returns both default and auto', () => {
    expect(normalizeCursorSdkListedModels(['default', 'auto', 'composer-2.5'])).toEqual([
      'auto',
      'composer-2.5',
    ]);
  });
});
