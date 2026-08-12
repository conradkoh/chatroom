import { describe, expect, it } from 'vitest';

import { getImageFilesFromClipboard, nameClipboardImageFile } from './clipboardImageFiles';

const clipboard = (items: { kind: string; type: string; file: File }[]) =>
  ({
    items: items.map(({ kind, type, file }) => ({ kind, type, getAsFile: () => file })),
  }) as unknown as DataTransfer;

describe('clipboard image files', () => {
  it('extracts only image items', () => {
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
