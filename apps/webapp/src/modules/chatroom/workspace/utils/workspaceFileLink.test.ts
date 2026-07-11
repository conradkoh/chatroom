import { describe, expect, it } from 'vitest';

import {
  isWorkspaceFileLink,
  looksLikeWorkspacePath,
  normalizeWorkspaceFilePath,
  resolveWorkspaceFileLinkOpenTarget,
  splitTextOnWorkspacePaths,
} from './workspaceFileLink';

describe('workspaceFileLink', () => {
  describe('looksLikeWorkspacePath', () => {
    it('returns true for repo-relative file paths with extension', () => {
      expect(looksLikeWorkspacePath('apps/webapp/src/foo.ts')).toBe(true);
      expect(looksLikeWorkspacePath('./README.md')).toBe(true);
      expect(looksLikeWorkspacePath('src/index.tsx')).toBe(true);
    });

    it('returns false for non-path text', () => {
      expect(looksLikeWorkspacePath('https://example.com')).toBe(false);
      expect(looksLikeWorkspacePath('npm test')).toBe(false);
      expect(looksLikeWorkspacePath('v1.2.3')).toBe(false);
      expect(looksLikeWorkspacePath('#section')).toBe(false);
      expect(looksLikeWorkspacePath('feat/single-segment')).toBe(false);
      expect(looksLikeWorkspacePath('hello world/foo.ts')).toBe(false);
    });
  });

  describe('splitTextOnWorkspacePaths', () => {
    it('splits prose into text and link nodes', () => {
      expect(splitTextOnWorkspacePaths('Updated apps/webapp/src/a.ts and more')).toEqual([
        { type: 'text', value: 'Updated ' },
        {
          type: 'link',
          url: 'apps/webapp/src/a.ts',
          children: [{ type: 'text', value: 'apps/webapp/src/a.ts' }],
        },
        { type: 'text', value: ' and more' },
      ]);
    });

    it('returns a single text node when no paths match', () => {
      expect(splitTextOnWorkspacePaths('no paths here')).toEqual([
        { type: 'text', value: 'no paths here' },
      ]);
    });

    it('matches full tsx extension (not truncated to ts)', () => {
      expect(
        splitTextOnWorkspacePaths('See apps/webapp/src/mdx-components.tsx for details')
      ).toEqual([
        { type: 'text', value: 'See ' },
        {
          type: 'link',
          url: 'apps/webapp/src/mdx-components.tsx',
          children: [{ type: 'text', value: 'apps/webapp/src/mdx-components.tsx' }],
        },
        { type: 'text', value: ' for details' },
      ]);
    });

    it('matches jsx, mjs, mdx, and scss extensions fully', () => {
      const input = 'a/apps/x.jsx b/pkg/index.mjs c/read.me.mdx d/styles/main.scss';
      const links = splitTextOnWorkspacePaths(input)
        .filter((n) => n.type === 'link')
        .map((n) => n.url);
      expect(links).toEqual([
        'a/apps/x.jsx',
        'b/pkg/index.mjs',
        'c/read.me.mdx',
        'd/styles/main.scss',
      ]);
    });
  });

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

  describe('resolveWorkspaceFileLinkOpenTarget', () => {
    it('returns explorer when explorer view and split messages panel enabled', () => {
      expect(resolveWorkspaceFileLinkOpenTarget('explorer', true)).toBe('explorer');
    });

    it('returns preview when explorer view but split panel disabled', () => {
      expect(resolveWorkspaceFileLinkOpenTarget('explorer', false)).toBe('preview');
    });

    it('returns preview when messages view', () => {
      expect(resolveWorkspaceFileLinkOpenTarget('messages', false)).toBe('preview');
      expect(resolveWorkspaceFileLinkOpenTarget('messages', true)).toBe('preview');
    });

    it('returns preview for other activity views', () => {
      expect(resolveWorkspaceFileLinkOpenTarget('source-control', true)).toBe('preview');
      expect(resolveWorkspaceFileLinkOpenTarget('processes', false)).toBe('preview');
    });
  });
});
