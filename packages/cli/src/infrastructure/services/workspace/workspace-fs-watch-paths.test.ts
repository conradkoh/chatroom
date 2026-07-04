import { describe, expect, it } from 'vitest';

import {
  dirsToRefreshForEvent,
  filterDirsByActiveSet,
  shouldIgnoreWatchRelativePath,
} from './workspace-fs-watch-paths.js';

describe('workspace-fs-watch-paths', () => {
  describe('shouldIgnoreWatchRelativePath', () => {
    it('ignores paths under excluded directories', () => {
      expect(shouldIgnoreWatchRelativePath('.git/HEAD')).toBe(true);
      expect(shouldIgnoreWatchRelativePath('node_modules/lodash/index.js')).toBe(true);
    });

    it('allows normal workspace paths', () => {
      expect(shouldIgnoreWatchRelativePath('src/foo/bar.ts')).toBe(false);
    });

    it('ignores turbo, next, and convex generated paths', () => {
      expect(shouldIgnoreWatchRelativePath('.turbo/cache/abc')).toBe(true);
      expect(shouldIgnoreWatchRelativePath('.next/server/chunks/foo.js')).toBe(true);
      expect(shouldIgnoreWatchRelativePath('convex/_generated/api.js')).toBe(true);
      expect(shouldIgnoreWatchRelativePath('services/backend/convex/_generated/server.js')).toBe(
        true
      );
    });
  });

  describe('dirsToRefreshForEvent', () => {
    it('refreshes parent dir for file events', () => {
      expect(dirsToRefreshForEvent('src/foo/bar.ts')).toEqual(['src/foo']);
    });

    it('refreshes dir and parent for directory events', () => {
      expect(dirsToRefreshForEvent('src/foo', true)).toEqual(['src', 'src/foo']);
    });

    it('refreshes root for workspace-level events', () => {
      expect(dirsToRefreshForEvent('.')).toEqual(['']);
      expect(dirsToRefreshForEvent('')).toEqual(['']);
    });
  });

  describe('filterDirsByActiveSet', () => {
    it('keeps only dirs present in the active watch set', () => {
      const active = new Set(['', 'src']);
      expect(filterDirsByActiveSet(['', 'src', 'src/foo'], active)).toEqual(['', 'src']);
    });
  });
});
