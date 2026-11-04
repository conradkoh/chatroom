import { describe, expect, it } from 'vitest';

import { fileExtensionLabel, formatFileSize } from './formatFileSize';

describe('formatFileSize', () => {
  it('formats zero bytes', () => {
    expect(formatFileSize(0)).toBe('0 B');
  });

  it('formats raw bytes without a decimal', () => {
    expect(formatFileSize(512)).toBe('512 B');
  });

  it('formats kilobytes with one decimal', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatFileSize(256 * 1024 * 1024)).toBe('256 MB');
  });

  it('formats gigabytes', () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB');
  });

  it('drops a trailing .0', () => {
    expect(formatFileSize(1024)).toBe('1 KB');
  });
});

describe('fileExtensionLabel', () => {
  it('uppercases the extension', () => {
    expect(fileExtensionLabel('shot.png')).toBe('PNG');
  });

  it('falls back to FILE without an extension', () => {
    expect(fileExtensionLabel('README')).toBe('FILE');
    expect(fileExtensionLabel('.env')).toBe('FILE');
    expect(fileExtensionLabel('trailing.')).toBe('FILE');
  });
});
