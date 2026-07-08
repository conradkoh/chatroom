import { describe, expect, it } from 'vitest';

import { editorPaneFlexClass, isEditorExpanded, previewPaneFlexClass } from './editorExpandLayout';

describe('editorExpandLayout', () => {
  describe('isEditorExpanded', () => {
    it('is false without split', () => {
      expect(isEditorExpanded(false, 'src/a.md', 'src/a.md')).toBe(false);
    });

    it('is false when expanded path does not match active tab', () => {
      expect(isEditorExpanded(true, 'src/a.md', 'src/b.md')).toBe(false);
    });

    it('is false when expanded path is null', () => {
      expect(isEditorExpanded(true, null, 'src/a.md')).toBe(false);
    });

    it('is true when split is open and expanded path matches active tab', () => {
      expect(isEditorExpanded(true, 'src/a.md', 'src/a.md')).toBe(true);
    });
  });

  describe('editorPaneFlexClass', () => {
    it('returns flex-1 when there is no split', () => {
      expect(editorPaneFlexClass(true, false)).toBe('flex-1');
    });

    it('returns flex-[9] when expanded with split', () => {
      expect(editorPaneFlexClass(true, true)).toBe('flex-[9]');
    });

    it('returns flex-1 when split but not expanded', () => {
      expect(editorPaneFlexClass(false, true)).toBe('flex-1');
    });
  });

  describe('previewPaneFlexClass', () => {
    it('returns flex-[1] when expanded', () => {
      expect(previewPaneFlexClass(true)).toBe('flex-[1]');
    });

    it('returns flex-1 when not expanded', () => {
      expect(previewPaneFlexClass(false)).toBe('flex-1');
    });
  });
});
