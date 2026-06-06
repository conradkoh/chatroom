import { describe, expect, it } from 'vitest';

import { mergeCursorSdkListedModels } from './cursor-sdk.config';

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
});
