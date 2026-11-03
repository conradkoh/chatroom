import { Blob as NodeBlob } from 'node:buffer';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadAttachment } from './downloadAttachment';

const ORIGINAL_BYTES = new Uint8Array([0, 1, 2, 3, 255]);

describe('downloadAttachment', () => {
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:download');
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(ORIGINAL_BYTES, { status: 200 }))
    );
    // jsdom's Blob has no arrayBuffer(); the Node implementation does.
    vi.stubGlobal('Blob', NodeBlob);
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('downloads the original bytes as an octet-stream blob', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await downloadAttachment('https://files.example/shot.png', 'shot.png');

    expect(fetch).toHaveBeenCalledWith('https://files.example/shot.png');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/octet-stream');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(ORIGINAL_BYTES);
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it('rejects when the response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 }))
    );

    await expect(
      downloadAttachment('https://files.example/missing.png', 'missing.png')
    ).rejects.toThrow('HTTP 404');
  });
});
