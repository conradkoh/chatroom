import { describe, expect, it } from 'vitest';

import { isWorkspaceFileLink, normalizeWorkspaceFilePath } from './workspaceFileLink';

describe('workspaceFileLink', () => {
  describe('isWorkspaceFileLink', () => {
    it('returns true for relative file paths', () => {
      expect(isWorkspaceFileLink('./README.md')).toBe(true);
      expect(isWorkspaceFileLink('src/index.ts')).toBe(true);
    });

    it('returns false for external URLs and anchors', () => {
      expect(isWorkspaceFileLink('https://example.com')).toBe(false);
      expect(isWorkspaceFileLink('http://example.com')).toBe(false);
      expect(isWorkspaceFileLink('mailto:a@b.com')).toBe(false);
      expect(isWorkspaceFileLink('#section')).toBe(false);
    });
  });

  describe('normalizeWorkspaceFilePath', () => {
    it('strips ./ prefix', () => {
      expect(normalizeWorkspaceFilePath('./apps/webapp/page.tsx')).toBe('apps/webapp/page.tsx');
    });

    it('strips file:// prefix', () => {
      expect(normalizeWorkspaceFilePath('file://src/foo.ts')).toBe('src/foo.ts');
    });
  });
});
