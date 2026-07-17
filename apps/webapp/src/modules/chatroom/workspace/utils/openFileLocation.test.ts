import { describe, expect, it } from 'vitest';

import { pendingHighlightForLocation } from './openFileLocation';

describe('openFileLocation', () => {
  describe('pendingHighlightForLocation', () => {
    it('returns null for path-only locations', () => {
      expect(pendingHighlightForLocation({ filePath: 'apps/webapp/src/foo.ts' })).toBeNull();
    });

    it('returns normalized highlight for line citations', () => {
      expect(
        pendingHighlightForLocation({
          filePath: 'apps/webapp/src/foo.ts',
          startLine: 42,
          endLine: 48,
        })
      ).toEqual({
        filePath: 'apps/webapp/src/foo.ts',
        startLine: 42,
        endLine: 48,
      });
    });

    it('defaults endLine to startLine for single-line citations', () => {
      expect(
        pendingHighlightForLocation({
          filePath: 'apps/webapp/src/foo.ts',
          startLine: 10,
        })
      ).toEqual({
        filePath: 'apps/webapp/src/foo.ts',
        startLine: 10,
        endLine: 10,
      });
    });
  });
});
