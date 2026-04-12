import { describe, expect, it } from 'vitest';

import {
  encodeFileReference,
  decodeFileReferences,
  decodeFileReferencesLegacy,
  generateTokenPrefix,
} from './fileReference';

const PREFIX = 'ab12cd';

describe('generateTokenPrefix', () => {
  it('returns a 6-char string', () => {
    const prefix = generateTokenPrefix();
    expect(prefix).toHaveLength(6);
  });

  it('returns alphanumeric characters', () => {
    const prefix = generateTokenPrefix();
    expect(prefix).toMatch(/^[a-z0-9]+$/);
  });

  it('returns different values on successive calls', () => {
    const a = generateTokenPrefix();
    const b = generateTokenPrefix();
    // Not guaranteed but extremely unlikely to collide
    expect(a).not.toBe(b);
  });
});

describe('encodeFileReference', () => {
  it('encodes a simple file reference with prefix', () => {
    const result = encodeFileReference('my-project', 'src/index.ts', PREFIX);
    expect(result).toBe('<ab12cd>{file:my-project:src/index.ts}');
  });

  it('encodes a file reference with spaces in path', () => {
    const result = encodeFileReference('workspace', 'src/My Component/index.tsx', PREFIX);
    expect(result).toBe('<ab12cd>{file:workspace:src/My Component/index.tsx}');
  });

  it('escapes closing braces in file path', () => {
    const result = encodeFileReference('ws', 'path/with}brace.ts', PREFIX);
    expect(result).toBe('<ab12cd>{file:ws:path/with\\}brace.ts}');
  });

  it('escapes closing braces in workspace name', () => {
    const result = encodeFileReference('ws}name', 'file.ts', PREFIX);
    expect(result).toBe('<ab12cd>{file:ws\\}name:file.ts}');
  });

  it('escapes colons in workspace name', () => {
    const result = encodeFileReference('ws:name', 'file.ts', PREFIX);
    expect(result).toBe('<ab12cd>{file:ws\\:name:file.ts}');
  });

  it('handles unicode characters in path', () => {
    const result = encodeFileReference('project', 'docs/日本語/README.md', PREFIX);
    expect(result).toBe('<ab12cd>{file:project:docs/日本語/README.md}');
  });

  it('throws for empty workspace', () => {
    expect(() => encodeFileReference('', 'file.ts', PREFIX)).toThrow();
  });

  it('throws for empty file path', () => {
    expect(() => encodeFileReference('workspace', '', PREFIX)).toThrow();
  });

  it('throws for empty prefix', () => {
    expect(() => encodeFileReference('workspace', 'file.ts', '')).toThrow();
  });
});

describe('decodeFileReferences', () => {
  it('decodes a single file reference', () => {
    const text = `Check <${PREFIX}>{file:my-project:src/index.ts} for details`;
    const refs = decodeFileReferences(text, PREFIX);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({
      workspace: 'my-project',
      filePath: 'src/index.ts',
      start: 6,
      end: 44,
    });
  });

  it('decodes multiple file references', () => {
    const text = `See <${PREFIX}>{file:ws:a.ts} and <${PREFIX}>{file:ws:b.ts}`;
    const refs = decodeFileReferences(text, PREFIX);
    expect(refs).toHaveLength(2);
    expect(refs[0]!.filePath).toBe('a.ts');
    expect(refs[1]!.filePath).toBe('b.ts');
  });

  it('tracks correct start/end positions', () => {
    const text = `See <${PREFIX}>{file:ws:a.ts} and <${PREFIX}>{file:ws:b.ts}`;
    const refs = decodeFileReferences(text, PREFIX);
    expect(refs[0]!.start).toBe(4);
    expect(refs[0]!.end).toBe(26);
    expect(refs[1]!.start).toBe(31);
    expect(refs[1]!.end).toBe(53);
  });

  it('handles paths with spaces', () => {
    const text = `<${PREFIX}>{file:ws:My Component/index.tsx}`;
    const refs = decodeFileReferences(text, PREFIX);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.filePath).toBe('My Component/index.tsx');
  });

  it('handles escaped closing braces in path', () => {
    const text = `<${PREFIX}>{file:ws:path/with\\}brace.ts}`;
    const refs = decodeFileReferences(text, PREFIX);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.filePath).toBe('path/with}brace.ts');
  });

  it('handles escaped closing braces in workspace', () => {
    const text = `<${PREFIX}>{file:ws\\}name:file.ts}`;
    const refs = decodeFileReferences(text, PREFIX);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.workspace).toBe('ws}name');
    expect(refs[0]!.filePath).toBe('file.ts');
  });

  it('handles escaped colons in workspace', () => {
    const text = `<${PREFIX}>{file:ws\\:name:file.ts}`;
    const refs = decodeFileReferences(text, PREFIX);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.workspace).toBe('ws:name');
    expect(refs[0]!.filePath).toBe('file.ts');
  });

  it('handles unicode characters in path', () => {
    const text = `<${PREFIX}>{file:project:docs/日本語/README.md}`;
    const refs = decodeFileReferences(text, PREFIX);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.filePath).toBe('docs/日本語/README.md');
  });

  it('does not decode with wrong prefix', () => {
    const text = `<${PREFIX}>{file:ws:a.ts}`;
    const refs = decodeFileReferences(text, 'xxxxxx');
    expect(refs).toHaveLength(0);
  });

  it('returns empty array when no references found', () => {
    const text = 'Just regular text without any references';
    const refs = decodeFileReferences(text, PREFIX);
    expect(refs).toHaveLength(0);
  });

  it('returns empty array for empty string', () => {
    expect(decodeFileReferences('', PREFIX)).toHaveLength(0);
  });

  it('returns empty array for empty prefix', () => {
    expect(decodeFileReferences('some text', '')).toHaveLength(0);
  });

  it('handles file reference at start of string', () => {
    const text = `<${PREFIX}>{file:ws:file.ts} is the entry point`;
    const refs = decodeFileReferences(text, PREFIX);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.start).toBe(0);
  });

  it('handles file reference at end of string', () => {
    const text = `Check out <${PREFIX}>{file:ws:file.ts}`;
    const refs = decodeFileReferences(text, PREFIX);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.end).toBe(text.length);
  });

  it('handles file reference with deeply nested path', () => {
    const text = `<${PREFIX}>{file:ws:a/b/c/d/e/f/g.ts}`;
    const refs = decodeFileReferences(text, PREFIX);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.filePath).toBe('a/b/c/d/e/f/g.ts');
  });

  it('ignores user-typed text that looks like file ref but has wrong prefix', () => {
    const text = `User typed {file:ws:a.ts} but real ref is <${PREFIX}>{file:ws:b.ts}`;
    const refs = decodeFileReferences(text, PREFIX);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.filePath).toBe('b.ts');
  });
});

describe('decodeFileReferencesLegacy', () => {
  it('decodes a single legacy file reference', () => {
    const text = 'Check {file://my-project/src/index.ts} for details';
    const refs = decodeFileReferencesLegacy(text);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({
      workspace: 'my-project',
      filePath: 'src/index.ts',
      start: 6,
      end: 38,
    });
  });

  it('decodes multiple legacy references', () => {
    const text = 'See {file://ws/a.ts} and {file://ws/b.ts}';
    const refs = decodeFileReferencesLegacy(text);
    expect(refs).toHaveLength(2);
    expect(refs[0]!.filePath).toBe('a.ts');
    expect(refs[1]!.filePath).toBe('b.ts');
  });

  it('handles escaped closing braces', () => {
    const text = '{file://ws/path/with\\}brace.ts}';
    const refs = decodeFileReferencesLegacy(text);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.filePath).toBe('path/with}brace.ts');
  });

  it('ignores escaped file reference literals', () => {
    const text = 'This is \\{file://not/a/reference} but {file://ws/real.ts} is';
    const refs = decodeFileReferencesLegacy(text);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.filePath).toBe('real.ts');
  });

  it('returns empty array for empty string', () => {
    expect(decodeFileReferencesLegacy('')).toHaveLength(0);
  });
});

describe('encode/decode roundtrip', () => {
  it('roundtrips a simple reference', () => {
    const encoded = encodeFileReference('ws', 'src/index.ts', PREFIX);
    const decoded = decodeFileReferences(encoded, PREFIX);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]!.workspace).toBe('ws');
    expect(decoded[0]!.filePath).toBe('src/index.ts');
  });

  it('roundtrips a reference with special characters', () => {
    const encoded = encodeFileReference('my-project', 'path/with}brace/and spaces/file.ts', PREFIX);
    const decoded = decodeFileReferences(encoded, PREFIX);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]!.workspace).toBe('my-project');
    expect(decoded[0]!.filePath).toBe('path/with}brace/and spaces/file.ts');
  });

  it('roundtrips workspace with colons', () => {
    const encoded = encodeFileReference('ws:with:colons', 'file.ts', PREFIX);
    const decoded = decodeFileReferences(encoded, PREFIX);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]!.workspace).toBe('ws:with:colons');
    expect(decoded[0]!.filePath).toBe('file.ts');
  });

  it('roundtrips unicode paths', () => {
    const encoded = encodeFileReference('project', 'docs/日本語/ファイル.md', PREFIX);
    const decoded = decodeFileReferences(encoded, PREFIX);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]!.workspace).toBe('project');
    expect(decoded[0]!.filePath).toBe('docs/日本語/ファイル.md');
  });

  it('roundtrips multiple references in one message', () => {
    const ref1 = encodeFileReference('ws', 'a.ts', PREFIX);
    const ref2 = encodeFileReference('ws', 'b.ts', PREFIX);
    const text = `Check ${ref1} and ${ref2}`;
    const decoded = decodeFileReferences(text, PREFIX);
    expect(decoded).toHaveLength(2);
    expect(decoded[0]!.filePath).toBe('a.ts');
    expect(decoded[1]!.filePath).toBe('b.ts');
  });

  it('roundtrips workspace with closing braces', () => {
    const encoded = encodeFileReference('my}workspace', 'file.ts', PREFIX);
    const decoded = decodeFileReferences(encoded, PREFIX);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]!.workspace).toBe('my}workspace');
    expect(decoded[0]!.filePath).toBe('file.ts');
  });
});
