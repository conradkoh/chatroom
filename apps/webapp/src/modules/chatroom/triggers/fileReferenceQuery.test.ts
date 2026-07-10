import { describe, expect, it } from 'vitest';

import {
  extractFileReferenceQuery,
  formatFileReferenceDrillDown,
  formatFileReferenceFinal,
  parseFileReferenceQuery,
} from './fileReferenceQuery';

describe('extractFileReferenceQuery', () => {
  it('returns empty string when only @ is typed', () => {
    expect(extractFileReferenceQuery('@', 0)).toBe('');
  });

  it('extracts unquoted path segments', () => {
    expect(extractFileReferenceQuery('@src/mod', 0)).toBe('src/mod');
  });

  it('extracts quoted segments with spaces', () => {
    expect(extractFileReferenceQuery('@"my folder"/sub', 0)).toBe('"my folder"/sub');
  });

  it('returns null when whitespace appears outside quotes', () => {
    expect(extractFileReferenceQuery('@src hello', 0)).toBeNull();
  });

  it('allows partial quoted query while typing', () => {
    expect(extractFileReferenceQuery('@"my fol', 0)).toBe('"my fol');
  });
});

describe('parseFileReferenceQuery', () => {
  it('treats a single segment as search term', () => {
    expect(parseFileReferenceQuery('src')).toEqual({ prefix: '', searchTerm: 'src' });
  });

  it('treats trailing slash as navigated prefix', () => {
    expect(parseFileReferenceQuery('src/')).toEqual({ prefix: 'src/', searchTerm: '' });
  });

  it('splits parent prefix from child search term', () => {
    expect(parseFileReferenceQuery('src/mod')).toEqual({ prefix: 'src/', searchTerm: 'mod' });
  });

  it('parses quoted folder prefixes', () => {
    expect(parseFileReferenceQuery('"my folder"/sub')).toEqual({
      prefix: 'my folder/',
      searchTerm: 'sub',
    });
  });
});

describe('formatFileReferenceDrillDown', () => {
  it('appends trailing slash for directories', () => {
    expect(formatFileReferenceDrillDown('very-long-folder-name')).toBe('very-long-folder-name/');
  });

  it('quotes segments that contain spaces', () => {
    expect(formatFileReferenceDrillDown('my folder')).toBe('"my folder"/');
  });

  it('quotes only segments with spaces in nested paths', () => {
    expect(formatFileReferenceDrillDown('src/my folder')).toBe('src/"my folder"/');
  });
});

describe('formatFileReferenceFinal', () => {
  it('returns plain path when no spaces', () => {
    expect(formatFileReferenceFinal('src/a.ts')).toBe('src/a.ts');
  });

  it('wraps path in quotes when it contains spaces', () => {
    expect(formatFileReferenceFinal('my folder/file name.txt')).toBe('@"my folder/file name.txt"');
  });
});
