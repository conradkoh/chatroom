import { describe, expect, it } from 'vitest';

import {
  encodeFileReference,
  decodeFileReferences,
  escapeFileReferenceLiterals,
} from './fileReference';

describe('encodeFileReference', () => {
  it('encodes a simple file reference', () => {
    const result = encodeFileReference('my-project', 'src/index.ts');
    expect(result).toBe('{file://my-project/src/index.ts}');
  });

  it('encodes a file reference with spaces in path', () => {
    const result = encodeFileReference('workspace', 'src/My Component/index.tsx');
    expect(result).toBe('{file://workspace/src/My Component/index.tsx}');
  });

  it('escapes closing braces in file path', () => {
    const result = encodeFileReference('ws', 'path/with}brace.ts');
    expect(result).toBe('{file://ws/path/with\\}brace.ts}');
  });

  it('escapes closing braces in workspace name', () => {
    const result = encodeFileReference('ws}name', 'file.ts');
    expect(result).toBe('{file://ws\\}name/file.ts}');
  });

  it('handles unicode characters in path', () => {
    const result = encodeFileReference('project', 'docs/日本語/README.md');
    expect(result).toBe('{file://project/docs/日本語/README.md}');
  });

  it('throws for empty workspace', () => {
    expect(() => encodeFileReference('', 'file.ts')).toThrow();
  });

  it('throws for empty file path', () => {
    expect(() => encodeFileReference('workspace', '')).toThrow();
  });
});

describe('decodeFileReferences', () => {
  it('decodes a single file reference', () => {
    const text = 'Check {file://my-project/src/index.ts} for details';
    const refs = decodeFileReferences(text);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({
      workspace: 'my-project',
      filePath: 'src/index.ts',
      start: 6,
      end: 38,
    });
  });

  it('decodes multiple file references', () => {
    const text = 'See {file://ws/a.ts} and {file://ws/b.ts}';
    const refs = decodeFileReferences(text);
    expect(refs).toHaveLength(2);
    expect(refs[0]!.filePath).toBe('a.ts');
    expect(refs[1]!.filePath).toBe('b.ts');
  });

  it('tracks correct start/end positions for multiple references', () => {
    const text = 'See {file://ws/a.ts} and {file://ws/b.ts}';
    const refs = decodeFileReferences(text);
    expect(refs[0]!.start).toBe(4);
    expect(refs[0]!.end).toBe(20);
    expect(refs[1]!.start).toBe(25);
    expect(refs[1]!.end).toBe(41);
  });

  it('handles paths with spaces', () => {
    const text = '{file://ws/My Component/index.tsx}';
    const refs = decodeFileReferences(text);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.filePath).toBe('My Component/index.tsx');
  });

  it('handles escaped closing braces in path', () => {
    const text = '{file://ws/path/with\\}brace.ts}';
    const refs = decodeFileReferences(text);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.filePath).toBe('path/with}brace.ts');
  });

  it('handles escaped closing braces in workspace', () => {
    const text = '{file://ws\\}name/file.ts}';
    const refs = decodeFileReferences(text);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.workspace).toBe('ws}name');
    expect(refs[0]!.filePath).toBe('file.ts');
  });

  it('handles unicode characters in path', () => {
    const text = '{file://project/docs/日本語/README.md}';
    const refs = decodeFileReferences(text);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.filePath).toBe('docs/日本語/README.md');
  });

  it('ignores escaped file reference literals', () => {
    const text = 'This is \\{file://not/a/reference} but {file://ws/real.ts} is';
    const refs = decodeFileReferences(text);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.filePath).toBe('real.ts');
  });

  it('returns empty array when no references found', () => {
    const text = 'Just regular text without any references';
    const refs = decodeFileReferences(text);
    expect(refs).toHaveLength(0);
  });

  it('returns empty array for empty string', () => {
    expect(decodeFileReferences('')).toHaveLength(0);
  });

  it('handles file references mixed with markdown', () => {
    const text = '**Bold** and `code` with {file://ws/src/index.ts} in *italic* text';
    const refs = decodeFileReferences(text);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.filePath).toBe('src/index.ts');
  });

  it('handles file reference at start of string', () => {
    const text = '{file://ws/file.ts} is the entry point';
    const refs = decodeFileReferences(text);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.start).toBe(0);
  });

  it('handles file reference at end of string', () => {
    const text = 'Check out {file://ws/file.ts}';
    const refs = decodeFileReferences(text);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.end).toBe(text.length);
  });

  it('handles file reference with deeply nested path', () => {
    const text = '{file://ws/a/b/c/d/e/f/g.ts}';
    const refs = decodeFileReferences(text);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.filePath).toBe('a/b/c/d/e/f/g.ts');
  });
});

describe('escapeFileReferenceLiterals', () => {
  it('escapes literal {file:// in user text', () => {
    const text = 'The format is {file://workspace/path}';
    const escaped = escapeFileReferenceLiterals(text);
    expect(escaped).toBe('The format is \\{file://workspace/path}');
  });

  it('escapes multiple occurrences', () => {
    const text = '{file://a} and {file://b}';
    const escaped = escapeFileReferenceLiterals(text);
    expect(escaped).toBe('\\{file://a} and \\{file://b}');
  });

  it('does not double-escape already escaped references', () => {
    const text = 'Already escaped \\{file://test}';
    const escaped = escapeFileReferenceLiterals(text);
    expect(escaped).toBe('Already escaped \\{file://test}');
  });

  it('returns unchanged text when no file references present', () => {
    const text = 'Just regular text';
    expect(escapeFileReferenceLiterals(text)).toBe(text);
  });

  it('handles empty string', () => {
    expect(escapeFileReferenceLiterals('')).toBe('');
  });
});

describe('encode/decode roundtrip', () => {
  it('roundtrips a simple reference', () => {
    const encoded = encodeFileReference('ws', 'src/index.ts');
    const decoded = decodeFileReferences(encoded);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]!.workspace).toBe('ws');
    expect(decoded[0]!.filePath).toBe('src/index.ts');
  });

  it('roundtrips a reference with special characters', () => {
    const encoded = encodeFileReference('my-project', 'path/with}brace/and spaces/file.ts');
    const decoded = decodeFileReferences(encoded);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]!.workspace).toBe('my-project');
    expect(decoded[0]!.filePath).toBe('path/with}brace/and spaces/file.ts');
  });

  it('roundtrips unicode paths', () => {
    const encoded = encodeFileReference('project', 'docs/日本語/ファイル.md');
    const decoded = decodeFileReferences(encoded);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]!.workspace).toBe('project');
    expect(decoded[0]!.filePath).toBe('docs/日本語/ファイル.md');
  });

  it('roundtrips multiple references in one message', () => {
    const ref1 = encodeFileReference('ws', 'a.ts');
    const ref2 = encodeFileReference('ws', 'b.ts');
    const text = `Check ${ref1} and ${ref2}`;
    const decoded = decodeFileReferences(text);
    expect(decoded).toHaveLength(2);
    expect(decoded[0]!.filePath).toBe('a.ts');
    expect(decoded[1]!.filePath).toBe('b.ts');
  });

  it('roundtrips workspace with special characters', () => {
    const encoded = encodeFileReference('my}workspace', 'file.ts');
    const decoded = decodeFileReferences(encoded);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]!.workspace).toBe('my}workspace');
    expect(decoded[0]!.filePath).toBe('file.ts');
  });
});
