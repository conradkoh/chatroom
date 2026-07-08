import { describe, expect, it } from 'vitest';

import {
  fileTabDoubleClickExpandAction,
  previewTabDoubleClickAction,
} from './explorerExpandHandlers';

describe('previewTabDoubleClickAction', () => {
  it('returns togglePreviewExpanded for preview tabs', () => {
    expect(previewTabDoubleClickAction('preview', 'src/a.md')).toEqual({
      action: 'togglePreviewExpanded',
      filePath: 'src/a.md',
    });
  });

  it('returns null for table tabs', () => {
    expect(previewTabDoubleClickAction('table', 'src/a.csv')).toBeNull();
  });

  it('returns null when active tab path is missing', () => {
    expect(previewTabDoubleClickAction('preview', null)).toBeNull();
  });
});

describe('fileTabDoubleClickExpandAction', () => {
  it('returns toggleEditorExpanded for pinned tabs', () => {
    expect(fileTabDoubleClickExpandAction(true, 'src/a.md')).toEqual({
      action: 'toggleEditorExpanded',
      filePath: 'src/a.md',
    });
  });

  it('returns pin for unpinned tabs', () => {
    expect(fileTabDoubleClickExpandAction(false, 'src/a.md')).toEqual({
      action: 'pin',
      filePath: 'src/a.md',
    });
  });
});
