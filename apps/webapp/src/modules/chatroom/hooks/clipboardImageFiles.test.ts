import { describe, expect, it } from 'vitest';

import {
  getFilesFromClipboard,
  getImageFilesFromClipboard,
  nameClipboardImageFile,
} from './clipboardImageFiles';

type Entry = { kind: string; type: string; file: File };

const clipboard = (items: Entry[], files: File[] = []) =>
  ({
    items: items.map(({ kind, type, file }) => ({ kind, type, getAsFile: () => file })),
    files,
  }) as unknown as DataTransfer;

describe('clipboard files', () => {
  it('getImageFilesFromClipboard extracts only image file items (sketch path)', () => {
    const image = new File(['x'], 'blob', { type: 'image/png' });
    const result = getImageFilesFromClipboard(
      clipboard([
        { kind: 'string', type: 'text/plain', file: image },
        { kind: 'file', type: 'image/png', file: image },
      ])
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('pasted-image.png');
  });

  it('accepts a files-only payload with no items', () => {
    const image = new File(['x'], 'blob', { type: 'image/png' });
    const result = getFilesFromClipboard(clipboard([], [image]));
    expect(result.map((f) => f.name)).toEqual(['pasted-image.png']);
  });

  it('accepts an item with an empty MIME type as a PNG', () => {
    const file = new File(['x'], 'blob', { type: '' });
    const result = getFilesFromClipboard(clipboard([{ kind: 'file', type: '', file }]));
    expect(result.map((f) => f.name)).toEqual(['pasted-image.png']);
    expect(result[0]?.type).toBe('image/png');
  });

  it('maps HEIC and HEIF to their own extensions, not png', () => {
    const heic = new File(['x'], 'blob', { type: 'image/heic' });
    const heif = new File(['x'], 'blob', { type: 'image/heif' });
    const result = getFilesFromClipboard(clipboard([], [heic, heif]));
    expect(result.map((f) => f.name)).toEqual(['pasted-image.heic', 'pasted-image-2.heif']);
  });

  it('lists a file present in both items and files once', () => {
    const image = new File(['x'], 'blob', { type: 'image/png' });
    const result = getFilesFromClipboard(
      clipboard([{ kind: 'file', type: 'image/png', file: image }], [image])
    );
    expect(result).toHaveLength(1);
  });

  it('accepts a non-image file and keeps its real name', () => {
    const pdf = new File(['%PDF'], 'report.pdf', { type: 'application/pdf' });
    const result = getFilesFromClipboard(clipboard([], [pdf]));
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(pdf);
  });

  it('names an unnamed non-image file by its MIME type', () => {
    const pdf = new File(['%PDF'], 'blob', { type: 'application/pdf' });
    const result = getFilesFromClipboard(clipboard([], [pdf]));
    expect(result.map((f) => f.name)).toEqual(['pasted-file.pdf']);
  });

  it('returns nothing for a string-only payload or a null clipboard', () => {
    const text = new File(['hi'], 'blob', { type: 'text/plain' });
    expect(
      getFilesFromClipboard(clipboard([{ kind: 'string', type: 'text/plain', file: text }]))
    ).toEqual([]);
    expect(getFilesFromClipboard(null)).toEqual([]);
  });

  it('names unnamed and multiple images', () => {
    const file = new File(['x'], 'blob', { type: 'image/png' });
    expect(nameClipboardImageFile(file, 0).name).toBe('pasted-image.png');
    expect(nameClipboardImageFile(file, 1).name).toBe('pasted-image-2.png');
  });

  it('preserves a meaningful filename', () => {
    const file = new File(['x'], 'photo.webp', { type: 'image/webp' });
    expect(nameClipboardImageFile(file, 0)).toBe(file);
  });
});
