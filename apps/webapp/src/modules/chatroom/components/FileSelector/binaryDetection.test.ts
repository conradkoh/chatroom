import { describe, expect, it } from 'vitest';

import { isBinaryFile, isBinaryFileContent } from './binaryDetection';

describe('isBinaryFileContent', () => {
  it('returns true when encoding is binary regardless of extension', () => {
    expect(isBinaryFileContent('readme.md', 'binary')).toBe(true);
  });

  it('returns false when encoding is utf8 for unknown extension', () => {
    expect(isBinaryFileContent('file.jsonnet', 'utf8')).toBe(false);
  });

  it('returns true for known binary extension without encoding', () => {
    expect(isBinaryFileContent('image.png')).toBe(true);
  });

  it('returns true for known binary extension with utf8 encoding (extension wins)', () => {
    expect(isBinaryFileContent('image.png', 'utf8')).toBe(true);
  });

  it('returns false for markdown without encoding', () => {
    expect(isBinaryFileContent('readme.md')).toBe(false);
  });
});

describe('isBinaryFile', () => {
  it('returns true for .png', () => {
    expect(isBinaryFile('image.png')).toBe(true);
  });

  it('returns false for .jsonnet', () => {
    expect(isBinaryFile('config.jsonnet')).toBe(false);
  });

  it('returns false for extensionless file', () => {
    expect(isBinaryFile('README')).toBe(false);
  });
});
