import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { promptSaveFile, saveBlobFile } from './downloadTextFile';

describe('saveBlobFile / promptSaveFile', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:url'), revokeObjectURL: vi.fn() });
    const anchor = { click: vi.fn() };
    vi.stubGlobal('document', {
      ...document,
      createElement: vi.fn(() => anchor),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('falls back to anchor download when showSaveFilePicker is unavailable', async () => {
    vi.stubGlobal('showSaveFilePicker', undefined);
    const result = await saveBlobFile('a.md', new Blob(['x']), {
      mimeType: 'text/markdown',
      extensions: ['.md'],
    });
    expect(result).toBe('downloaded');
  });

  it('returns cancelled when picker throws AbortError', async () => {
    vi.stubGlobal(
      'showSaveFilePicker',
      vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'))
    );
    const result = await promptSaveFile('a.docx', {
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extensions: ['.docx'],
    });
    expect(result).toEqual({ kind: 'cancelled' });
  });

  it('writes blob to file handle when picker succeeds', async () => {
    const close = vi.fn();
    const write = vi.fn();
    const createWritable = vi.fn().mockResolvedValue({ write, close });
    const handle = { createWritable };
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockResolvedValue(handle));

    const result = await saveBlobFile('a.md', new Blob(['hello']), {
      mimeType: 'text/markdown',
      extensions: ['.md'],
    });
    expect(result).toBe('saved');
    expect(write).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
});
