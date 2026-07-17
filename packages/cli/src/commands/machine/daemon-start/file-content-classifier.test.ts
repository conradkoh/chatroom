import { describe, expect, it } from 'vitest';

import { classifyFileContent } from './file-content-classifier';

function textBuffer(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('classifyFileContent', () => {
  it('classifies .png as binary by extension', () => {
    const result = classifyFileContent('image.png', textBuffer('fake png data'));
    expect(result.kind).toBe('binary');
    expect(result.encoding).toBe('binary');
  });

  it('classifies .pdf as binary by extension', () => {
    const result = classifyFileContent('doc.pdf', textBuffer('fake pdf'));
    expect(result.kind).toBe('binary');
  });

  it('classifies .jsonnet text as utf8', () => {
    const buffer = textBuffer('local x = 1; { key: x }');
    const result = classifyFileContent('config.jsonnet', buffer);
    expect(result.kind).toBe('text');
    expect(result.encoding).toBe('utf8');
  });

  it('classifies .libsonnet text as utf8', () => {
    const buffer = textBuffer('{ foo: "bar" }');
    const result = classifyFileContent('config.libsonnet', buffer);
    expect(result.kind).toBe('text');
  });

  it('classifies .jsonnet with NUL byte as binary', () => {
    const buf = new Uint8Array([0x48, 0x00, 0x65, 0x6c, 0x6c, 0x6f]);
    const result = classifyFileContent('bad.jsonnet', buf);
    expect(result.kind).toBe('binary');
  });

  it('classifies invalid UTF-8 as binary', () => {
    const buf = new Uint8Array([0xff, 0xfe, 0x00]);
    const result = classifyFileContent('unknown.bin', buf);
    expect(result.kind).toBe('binary');
  });

  it('classifies empty .jsonnet as text', () => {
    const result = classifyFileContent('empty.jsonnet', new Uint8Array(0));
    expect(result.kind).toBe('text');
  });

  it('classifies extensionless UTF-8 as text', () => {
    const buffer = textBuffer('Hello, this is a README file.');
    const result = classifyFileContent('README', buffer);
    expect(result.kind).toBe('text');
  });

  it('classifies extensionless with NUL as binary', () => {
    const buf = new Uint8Array([0xff, 0xfe, 0x00]);
    const result = classifyFileContent('noext', buf);
    expect(result.kind).toBe('binary');
  });
});
