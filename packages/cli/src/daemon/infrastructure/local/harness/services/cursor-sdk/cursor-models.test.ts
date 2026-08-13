import { describe, expect, it } from 'vitest';

import {
  decodeCursorVariant,
  resolveCursorSdkModel,
  resolveCursorSdkSpawnModelId,
  resolveCursorSdkSpawnModelSelection,
} from './cursor-models.js';

describe('decodeCursorVariant', () => {
  it('decodes canonical effort variant to CLI slug', () => {
    expect(decodeCursorVariant('gpt-5.4[effort=high]')).toEqual({
      cliSlug: 'gpt-5.4-high',
      params: { effort: 'high' },
    });
  });
  it('accepts plain legacy slugs', () => {
    expect(decodeCursorVariant('gpt-5.4-high')).toEqual({
      cliSlug: 'gpt-5.4-high',
      params: { effort: 'high' },
    });
    expect(decodeCursorVariant('auto')).toEqual({ cliSlug: 'auto', params: {} });
  });
  it('decodes thinking + effort regardless of param order', () => {
    expect(decodeCursorVariant('claude-4.6-opus[thinking=enabled,effort=high]')).toEqual({
      cliSlug: 'claude-4.6-opus-high-thinking',
      params: { thinking: 'enabled', effort: 'high' },
    });
    expect(decodeCursorVariant('claude-4.6-opus[effort=high,thinking=enabled]')).toEqual({
      cliSlug: 'claude-4.6-opus-high-thinking',
      params: { effort: 'high', thinking: 'enabled' },
    });
  });
  it('rejects malformed variants', () => {
    expect(() => decodeCursorVariant('gpt-5.4[effort')).toThrow();
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

describe('resolveCursorSdkSpawnModelId', () => {
  it('decodes variants and prefixes', () => {
    expect(resolveCursorSdkSpawnModelId('gpt-5.4[effort=high]')).toBe('gpt-5.4-high');
    expect(resolveCursorSdkSpawnModelId('cursor/default')).toBe('auto');
  });
});

describe('resolveCursorSdkSpawnModelSelection', () => {
  it('decodes bracket variants to ModelSelection', () => {
    expect(resolveCursorSdkSpawnModelSelection('gpt-5.4[effort=high]')).toEqual({
      id: 'gpt-5.4',
      params: [{ id: 'effort', value: 'high' }],
    });
    expect(resolveCursorSdkSpawnModelSelection('gpt-5.6-terra[effort=high]')).toEqual({
      id: 'gpt-5.6-terra',
      params: [{ id: 'effort', value: 'high' }],
    });
  });

  it('maps auto to default', () => {
    expect(resolveCursorSdkSpawnModelSelection('cursor/default')).toEqual({ id: 'default' });
    expect(resolveCursorSdkSpawnModelSelection('auto')).toEqual({ id: 'default' });
  });
});
