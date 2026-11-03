import { describe, expect, test } from 'vitest';

import {
  getFilePreviewKind,
  getStoredBlobContentType,
  isValidAttachmentFilename,
  resolveFileAttachmentType,
} from './file-attachment';

describe('resolveFileAttachmentType', () => {
  test('resolves extensions case-insensitively on the basename', () => {
    expect(resolveFileAttachmentType('PHOTO.JPG')).toEqual({
      mimeType: 'image/jpeg',
      previewKind: 'image',
      activeContent: false,
    });
    expect(resolveFileAttachmentType('docs/REPORT.PDF')).toEqual({
      mimeType: 'application/pdf',
      previewKind: 'pdf',
      activeContent: false,
    });
  });

  test('returns null for disallowed extensions and missing extensions', () => {
    expect(resolveFileAttachmentType('malware.exe')).toBeNull();
    expect(resolveFileAttachmentType('README')).toBeNull();
  });

  test('flags SVG and HTML as active content', () => {
    expect(resolveFileAttachmentType('logo.svg')).toEqual({
      mimeType: 'image/svg+xml',
      previewKind: 'image',
      activeContent: true,
    });
    expect(resolveFileAttachmentType('page.html')).toEqual({
      mimeType: 'text/html',
      previewKind: 'text',
      activeContent: true,
    });
  });
});

describe('getStoredBlobContentType', () => {
  test('active content is stored as opaque bytes', () => {
    expect(getStoredBlobContentType('image/svg+xml')).toBe('application/octet-stream');
    expect(getStoredBlobContentType('text/html')).toBe('application/octet-stream');
  });

  test('inactive content keeps its MIME type', () => {
    expect(getStoredBlobContentType('image/png')).toBe('image/png');
  });
});

describe('getFilePreviewKind', () => {
  test('unknown MIME types fall back to download', () => {
    expect(getFilePreviewKind('foo/bar')).toBe('download');
  });

  test('pdf maps to pdf preview', () => {
    expect(getFilePreviewKind('application/pdf')).toBe('pdf');
  });
});

describe('isValidAttachmentFilename', () => {
  test.each(['a/b.png', 'a\\b.png', `bad\u0007name.png`, '', '.', '..'])(
    'rejects %j',
    (filename) => {
      expect(isValidAttachmentFilename(filename)).toBe(false);
    }
  );

  test('rejects names longer than 255 characters', () => {
    expect(isValidAttachmentFilename('a'.repeat(256))).toBe(false);
  });

  test('accepts names up to 255 characters', () => {
    expect(isValidAttachmentFilename('a'.repeat(255))).toBe(true);
  });
});
