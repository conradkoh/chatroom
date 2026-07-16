import { describe, expect, it } from 'vitest';

import { parseFileLocation, serializeFileLocationHref, type FileLocation } from './fileLocation';

describe('fileLocation', () => {
  describe('serializeFileLocationHref', () => {
    it('returns plain path when no line numbers', () => {
      const loc: FileLocation = { filePath: 'apps/webapp/src/foo.ts' };
      expect(serializeFileLocationHref(loc)).toBe('apps/webapp/src/foo.ts');
    });

    it('serializes single line as path hash fragment', () => {
      const loc: FileLocation = { filePath: 'apps/webapp/src/foo.ts', startLine: 42 };
      expect(serializeFileLocationHref(loc)).toBe('apps/webapp/src/foo.ts#L42');
    });

    it('serializes line range as path hash fragment', () => {
      const loc: FileLocation = {
        filePath: 'apps/webapp/src/foo.ts',
        startLine: 42,
        endLine: 48,
      };
      expect(serializeFileLocationHref(loc)).toBe('apps/webapp/src/foo.ts#L42-L48');
    });
  });

  describe('parseFileLocation', () => {
    it('parses plain repo-relative path', () => {
      expect(parseFileLocation('apps/webapp/src/foo.ts')).toEqual({
        filePath: 'apps/webapp/src/foo.ts',
      });
    });

    it('parses path with single line suffix', () => {
      expect(parseFileLocation('apps/webapp/src/foo.ts:42')).toEqual({
        filePath: 'apps/webapp/src/foo.ts',
        startLine: 42,
        endLine: 42,
      });
    });

    it('parses path with line range suffix', () => {
      expect(parseFileLocation('apps/webapp/src/foo.ts:42-48')).toEqual({
        filePath: 'apps/webapp/src/foo.ts',
        startLine: 42,
        endLine: 48,
      });
    });

    it('parses path hash fragment citations', () => {
      expect(parseFileLocation('apps/webapp/src/foo.ts#L42')).toEqual({
        filePath: 'apps/webapp/src/foo.ts',
        startLine: 42,
        endLine: 42,
      });
      expect(parseFileLocation('apps/webapp/src/foo.ts#L42-L48')).toEqual({
        filePath: 'apps/webapp/src/foo.ts',
        startLine: 42,
        endLine: 48,
      });
    });

    it('parses workspace href with single line fragment', () => {
      expect(parseFileLocation('workspace:apps/webapp/src/foo.ts#L42')).toEqual({
        filePath: 'apps/webapp/src/foo.ts',
        startLine: 42,
        endLine: 42,
      });
    });

    it('parses workspace href with line range fragment', () => {
      expect(parseFileLocation('workspace:apps/webapp/src/foo.ts#L42-L48')).toEqual({
        filePath: 'apps/webapp/src/foo.ts',
        startLine: 42,
        endLine: 48,
      });
    });

    it('normalizes ./ prefix and file:// protocol', () => {
      expect(parseFileLocation('./apps/webapp/src/foo.ts:10')).toEqual({
        filePath: 'apps/webapp/src/foo.ts',
        startLine: 10,
        endLine: 10,
      });
      expect(parseFileLocation('workspace:file://apps/webapp/src/foo.ts#L5')).toEqual({
        filePath: 'apps/webapp/src/foo.ts',
        startLine: 5,
        endLine: 5,
      });
    });

    it('returns null for empty or non-path input', () => {
      expect(parseFileLocation('')).toBeNull();
      expect(parseFileLocation('   ')).toBeNull();
      expect(parseFileLocation('not-a-path')).toBeNull();
    });
  });

  describe('round-trip', () => {
    it('round-trips line citations through serialize and parse', () => {
      const loc: FileLocation = {
        filePath: 'apps/webapp/src/foo.ts',
        startLine: 42,
        endLine: 48,
      };
      expect(parseFileLocation(serializeFileLocationHref(loc))).toEqual(loc);
    });
  });
});
