/**
 * Tests for the file reference parsing module.
 */

import { describe, expect, it } from 'vitest';

import { decodeWorkspaceId, parseFileReference, extractFileReferences } from './fileReference.js';

// Helper: encode a (machineId, workingDir) pair using Node Buffer base64url
function encodeWorkspaceId(machineId: string, workingDir: string): string {
  const raw = `${machineId}::${workingDir}`;
  return Buffer.from(raw, 'utf-8').toString('base64url');
}

// ============================================================================
// decodeWorkspaceId
// ============================================================================

describe('decodeWorkspaceId', () => {
  it('decodes a valid base64url-encoded workspace ID', () => {
    const encoded = encodeWorkspaceId('machine-abc', '/Users/alice/chatroom');
    const result = decodeWorkspaceId(encoded);
    expect(result).toEqual({
      machineId: 'machine-abc',
      workingDir: '/Users/alice/chatroom',
    });
  });

  it('handles machineId with special characters', () => {
    const encoded = encodeWorkspaceId('m4ch!ne_id-123', '/home/user/project');
    const result = decodeWorkspaceId(encoded);
    expect(result.machineId).toBe('m4ch!ne_id-123');
    expect(result.workingDir).toBe('/home/user/project');
  });

  it('handles workingDir containing :: (split on first occurrence only)', () => {
    const encoded = encodeWorkspaceId('machineX', '/path/with::colons/dir');
    const result = decodeWorkspaceId(encoded);
    expect(result.machineId).toBe('machineX');
    expect(result.workingDir).toBe('/path/with::colons/dir');
  });

  it('handles non-ASCII characters (UTF-8)', () => {
    const encoded = encodeWorkspaceId('máquina', '/Users/ユーザー/プロジェクト');
    const result = decodeWorkspaceId(encoded);
    expect(result.machineId).toBe('máquina');
    expect(result.workingDir).toBe('/Users/ユーザー/プロジェクト');
  });

  it('round-trips with the local encode helper', () => {
    const pairs = [
      ['m1', '/a/b/c'],
      ['long-machine-id-with-dashes', '/very/deep/nested/path/to/project'],
      ['simple', 'relative-path'],
    ] as const;
    for (const [machineId, workingDir] of pairs) {
      const encoded = encodeWorkspaceId(machineId, workingDir);
      expect(decodeWorkspaceId(encoded)).toEqual({ machineId, workingDir });
    }
  });

  it('throws on invalid base64url input', () => {
    expect(() => decodeWorkspaceId('!!!not-base64!!!')).toThrow('missing separator');
  });

  it('throws when separator is missing', () => {
    // Valid base64url but no :: separator
    const encoded = Buffer.from('just-a-string-no-separator', 'utf-8').toString('base64url');
    expect(() => decodeWorkspaceId(encoded)).toThrow('missing separator');
  });

  it('throws on empty string', () => {
    expect(() => decodeWorkspaceId('')).toThrow('missing separator');
  });
});

// ============================================================================
// parseFileReference
// ============================================================================

describe('parseFileReference', () => {
  it('parses a valid {file://workspaceId/path} token', () => {
    const result = parseFileReference('{file://abc123/src/index.ts}');
    expect(result).toEqual({
      workspaceId: 'abc123',
      filePath: 'src/index.ts',
    });
  });

  it('parses paths with spaces', () => {
    const result = parseFileReference('{file://ws1/my folder/my file.txt}');
    expect(result).toEqual({
      workspaceId: 'ws1',
      filePath: 'my folder/my file.txt',
    });
  });

  it('parses deeply nested paths', () => {
    const result = parseFileReference('{file://w/a/b/c/d/e/f.ts}');
    expect(result).toEqual({
      workspaceId: 'w',
      filePath: 'a/b/c/d/e/f.ts',
    });
  });

  it('parses base64url workspace IDs', () => {
    const wsId = encodeWorkspaceId('m1', '/home/user/proj');
    const token = `{file://${wsId}/src/main.ts}`;
    const result = parseFileReference(token);
    expect(result).toEqual({
      workspaceId: wsId,
      filePath: 'src/main.ts',
    });
  });

  it('returns null for missing prefix', () => {
    expect(parseFileReference('file://ws/path}')).toBeNull();
    expect(parseFileReference('{ws/path}')).toBeNull();
  });

  it('returns null for missing closing brace', () => {
    expect(parseFileReference('{file://ws/path')).toBeNull();
  });

  it('returns null for empty workspace', () => {
    expect(parseFileReference('{file:///path}')).toBeNull();
  });

  it('returns null for empty path', () => {
    expect(parseFileReference('{file://ws/}')).toBeNull();
  });

  it('returns null for workspace only (no slash)', () => {
    expect(parseFileReference('{file://ws}')).toBeNull();
  });

  it('returns null for empty token', () => {
    expect(parseFileReference('')).toBeNull();
  });
});

// ============================================================================
// extractFileReferences
// ============================================================================

describe('extractFileReferences', () => {
  it('extracts a single reference from text', () => {
    const text = 'Look at {file://ws1/src/index.ts} for details';
    const refs = extractFileReferences(text);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({
      workspaceId: 'ws1',
      filePath: 'src/index.ts',
      raw: '{file://ws1/src/index.ts}',
      start: 8,
      end: 33,
    });
  });

  it('extracts multiple references from text', () => {
    const text = 'See {file://ws1/a.ts} and {file://ws2/b.ts} for context';
    const refs = extractFileReferences(text);
    expect(refs).toHaveLength(2);
    expect(refs[0].filePath).toBe('a.ts');
    expect(refs[0].workspaceId).toBe('ws1');
    expect(refs[1].filePath).toBe('b.ts');
    expect(refs[1].workspaceId).toBe('ws2');
  });

  it('returns empty array for text with no references', () => {
    expect(extractFileReferences('No references here')).toEqual([]);
    expect(extractFileReferences('')).toEqual([]);
  });

  it('skips escaped references (preceded by backslash)', () => {
    const text = 'Normal {file://ws/a.ts} and escaped \\{file://ws/b.ts}';
    const refs = extractFileReferences(text);
    expect(refs).toHaveLength(1);
    expect(refs[0].filePath).toBe('a.ts');
  });

  it('handles references at the start and end of text', () => {
    const text = '{file://ws/start.ts} middle {file://ws/end.ts}';
    const refs = extractFileReferences(text);
    expect(refs).toHaveLength(2);
    expect(refs[0].start).toBe(0);
    expect(refs[1].end).toBe(text.length);
  });

  it('returns correct start/end positions', () => {
    const text = 'prefix {file://ws/file.ts} suffix';
    const refs = extractFileReferences(text);
    expect(refs).toHaveLength(1);
    expect(text.slice(refs[0].start, refs[0].end)).toBe('{file://ws/file.ts}');
  });

  it('handles adjacent references without space', () => {
    const text = '{file://ws/a.ts}{file://ws/b.ts}';
    const refs = extractFileReferences(text);
    expect(refs).toHaveLength(2);
    expect(refs[0].filePath).toBe('a.ts');
    expect(refs[1].filePath).toBe('b.ts');
  });

  it('handles references with base64url workspace IDs', () => {
    const wsId = encodeWorkspaceId('machine-1', '/home/user/project');
    const text = `Check {file://${wsId}/src/main.ts} for the entry point`;
    const refs = extractFileReferences(text);
    expect(refs).toHaveLength(1);
    expect(refs[0].workspaceId).toBe(wsId);
    expect(refs[0].filePath).toBe('src/main.ts');
  });

  it('skips malformed references (no path)', () => {
    const text = 'Bad: {file://ws} Good: {file://ws/ok.ts}';
    const refs = extractFileReferences(text);
    expect(refs).toHaveLength(1);
    expect(refs[0].filePath).toBe('ok.ts');
  });
});
