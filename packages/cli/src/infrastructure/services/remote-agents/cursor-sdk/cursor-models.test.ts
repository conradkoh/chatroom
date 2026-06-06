import { describe, expect, it } from 'vitest';

import { mergeCursorSdkListedModels, resolveCursorSdkModel } from './cursor-models.js';

describe('resolveCursorSdkModel', () => {
  it('strips cursor/ prefix for SDK', () => {
    expect(resolveCursorSdkModel('cursor/composer-2.5')).toBe('composer-2.5');
  });

  it('passes through bare slugs', () => {
    expect(resolveCursorSdkModel('auto')).toBe('auto');
  });
});

describe('mergeCursorSdkListedModels', () => {
  it('prepends auto when missing from Cursor.models.list', () => {
    expect(mergeCursorSdkListedModels(['default', 'composer-2.5'])).toEqual([
      'auto',
      'default',
      'composer-2.5',
    ]);
  });

  it('does not duplicate auto when already listed', () => {
    expect(mergeCursorSdkListedModels(['auto', 'composer-2.5'])).toEqual(['auto', 'composer-2.5']);
  });

  it('includes auto built-in model', () => {
    expect(mergeCursorSdkListedModels(['composer-2.5'])).toContain('auto');
  });
});
