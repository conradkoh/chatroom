import { describe, expect, it } from 'vitest';

import {
  editorPaneFlexClass,
  isEditorExpanded,
  isPreviewExpanded,
  previewPaneFlexClass,
} from './editorExpandLayout';

describe('editorExpandLayout', () => {
  describe('isEditorExpanded', () => {
    it('is false without split', () => {
      expect(isEditorExpanded(false, 'src/a.md', 'editor', 'src/a.md')).toBe(false);
    });

    it('is false when expanded path does not match active tab', () => {
      expect(isEditorExpanded(true, 'src/a.md', 'editor', 'src/b.md')).toBe(false);
    });

    it('is false when expanded path is null', () => {
      expect(isEditorExpanded(true, null, null, 'src/a.md')).toBe(false);
    });

    it('is false when pane is preview', () => {
      expect(isEditorExpanded(true, 'src/a.md', 'preview', 'src/a.md')).toBe(false);
    });

    it('is true when split is open, pane is editor, and paths match', () => {
      expect(isEditorExpanded(true, 'src/a.md', 'editor', 'src/a.md')).toBe(true);
    });
  });

  describe('isPreviewExpanded', () => {
    it('is false without split', () => {
      expect(isPreviewExpanded(false, 'src/a.md', 'preview', 'src/a.md')).toBe(false);
    });

    it('is false when pane is editor', () => {
      expect(isPreviewExpanded(true, 'src/a.md', 'editor', 'src/a.md')).toBe(false);
    });

    it('is true when pane is preview and paths match', () => {
      expect(isPreviewExpanded(true, 'src/a.md', 'preview', 'src/a.md')).toBe(true);
    });
  });

  describe('editorPaneFlexClass', () => {
    it('returns flex-1 when there is no split', () => {
      expect(editorPaneFlexClass(true, false, false)).toBe('flex-1');
    });

    it('returns flex-[9] when editor expanded with split', () => {
      expect(editorPaneFlexClass(true, false, true)).toBe('flex-[9]');
    });

    it('returns flex-[1] when preview expanded', () => {
      expect(editorPaneFlexClass(false, true, true)).toBe('flex-[1]');
    });

    it('returns flex-1 when split but not expanded', () => {
      expect(editorPaneFlexClass(false, false, true)).toBe('flex-1');
    });
  });

  describe('previewPaneFlexClass', () => {
    it('returns flex-[9] when preview expanded', () => {
      expect(previewPaneFlexClass(false, true)).toBe('flex-[9]');
    });

    it('returns flex-[1] when editor expanded', () => {
      expect(previewPaneFlexClass(true, false)).toBe('flex-[1]');
    });

    it('returns flex-1 when not expanded', () => {
      expect(previewPaneFlexClass(false, false)).toBe('flex-1');
    });
  });
});
