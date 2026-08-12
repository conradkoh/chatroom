import { describe, expect, it } from 'vitest';

import { decodeCursorVariant, normalizeCursorSdkListedModels, resolveCursorSdkModel } from './cursor-models.js';

describe('decodeCursorVariant', () => {
  it('decodes canonical effort variant to CLI slug', () => {
    expect(decodeCursorVariant('gpt-5.4[effort=high]')).toEqual({ cliSlug: 'gpt-5.4-high', params: { effort: 'high' } });
  });
  it('accepts plain legacy slugs', () => {
    expect(decodeCursorVariant('gpt-5.4-high')).toEqual({ cliSlug: 'gpt-5.4-high', params: { effort: 'high' } });
    expect(decodeCursorVariant('auto')).toEqual({ cliSlug: 'auto', params: {} });
  });
  it('decodes thinking + effort regardless of param order', () => {
    expect(decodeCursorVariant('claude-4.6-opus[thinking=enabled,effort=high]')).toEqual({ cliSlug: 'claude-4.6-opus-high-thinking', params: { thinking: 'enabled', effort: 'high' } });
    expect(decodeCursorVariant('claude-4.6-opus[effort=high,thinking=enabled]')).toEqual({ cliSlug: 'claude-4.6-opus-high-thinking', params: { effort: 'high', thinking: 'enabled' } });
  });
  it('rejects malformed and unknown variants', () => {
    expect(() => decodeCursorVariant('gpt-5.4[effort')).toThrow();
    expect(() => decodeCursorVariant('gpt-5.4[effort=ultra]')).toThrow();
  });
});

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
