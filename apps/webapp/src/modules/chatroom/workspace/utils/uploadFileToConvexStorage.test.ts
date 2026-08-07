import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { uploadFileToConvexStorage } from './uploadFileToConvexStorage';

type MockXhrHandlers = {
  onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void;
  onload?: () => void;
  onerror?: () => void;
};

function createMockXhr() {
  const handlers: MockXhrHandlers = {};
  const xhr = {
    open: vi.fn(),
    setRequestHeader: vi.fn(),
    send: vi.fn(),
    upload: handlers,
    status: 200,
    responseText: '{"storageId":"storage-1"}',
    set onprogress(fn: MockXhrHandlers['onprogress']) {
      handlers.onprogress = fn;
    },
    set onload(fn: MockXhrHandlers['onload']) {
      handlers.onload = fn;
    },
    set onerror(fn: MockXhrHandlers['onerror']) {
      handlers.onerror = fn;
    },
    get handlers() {
      return handlers;
    },
  };
  return xhr;
}

describe('uploadFileToConvexStorage', () => {
  let xhr: ReturnType<typeof createMockXhr>;
  let originalXhr: typeof XMLHttpRequest;

  beforeEach(() => {
    originalXhr = globalThis.XMLHttpRequest;
    xhr = createMockXhr();
    const MockXhr = function () {
      return xhr;
    } as unknown as typeof XMLHttpRequest;
    globalThis.XMLHttpRequest = MockXhr;
  });

  afterEach(() => {
    globalThis.XMLHttpRequest = originalXhr;
  });

  it('posts the file with the correct content type and resolves the storageId', async () => {
    const file = new File(['hello'], 'notes.md', { type: 'text/markdown' });
    const promise = uploadFileToConvexStorage('https://upload.example', file);

    expect(xhr.open).toHaveBeenCalledWith('POST', 'https://upload.example');
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('Content-Type', 'text/markdown');
    expect(xhr.send).toHaveBeenCalledWith(file);

    xhr.status = 200;
    xhr.responseText = '{"storageId":"storage-1"}';
    xhr.handlers.onload?.();

    await expect(promise).resolves.toEqual({ storageId: 'storage-1' });
  });

  it('defaults content type to octet-stream when file has no type', async () => {
    const file = new File(['hello'], 'notes.md');
    const promise = uploadFileToConvexStorage('https://upload.example', file);

    expect(xhr.setRequestHeader).toHaveBeenCalledWith('Content-Type', 'application/octet-stream');

    xhr.status = 200;
    xhr.responseText = '{"storageId":"storage-1"}';
    xhr.handlers.onload?.();

    await expect(promise).resolves.toEqual({ storageId: 'storage-1' });
  });

  it('reports byte progress via onProgress when length is computable', async () => {
    const file = new File([new Uint8Array(1000)], 'big.bin', { type: 'application/octet-stream' });
    const onProgress = vi.fn();
    const promise = uploadFileToConvexStorage('https://upload.example', file, onProgress);

    xhr.handlers.onprogress?.({ lengthComputable: true, loaded: 250, total: 1000 });
    xhr.handlers.onprogress?.({ lengthComputable: true, loaded: 1000, total: 1000 });
    xhr.handlers.onprogress?.({ lengthComputable: false, loaded: 0, total: 0 });

    expect(onProgress).toHaveBeenNthCalledWith(1, 250, 1000);
    expect(onProgress).toHaveBeenNthCalledWith(2, 1000, 1000);
    expect(onProgress).toHaveBeenCalledTimes(2);

    xhr.status = 200;
    xhr.responseText = '{"storageId":"storage-1"}';
    xhr.handlers.onload?.();

    await promise;
  });

  it('rejects on non-2xx status', async () => {
    const file = new File(['hello'], 'notes.md');
    const promise = uploadFileToConvexStorage('https://upload.example', file);

    xhr.status = 500;
    xhr.responseText = '{"error":"boom"}';
    xhr.handlers.onload?.();

    await expect(promise).rejects.toThrow('Failed to upload file');
  });

  it('rejects when response has no storageId', async () => {
    const file = new File(['hello'], 'notes.md');
    const promise = uploadFileToConvexStorage('https://upload.example', file);

    xhr.status = 200;
    xhr.responseText = '{}';
    xhr.handlers.onload?.();

    await expect(promise).rejects.toThrow('Failed to upload file');
  });

  it('rejects when the response is not valid JSON', async () => {
    const file = new File(['hello'], 'notes.md');
    const promise = uploadFileToConvexStorage('https://upload.example', file);

    xhr.status = 200;
    xhr.responseText = 'not-json';
    xhr.handlers.onload?.();

    await expect(promise).rejects.toThrow('Failed to upload file');
  });

  it('rejects on network error', async () => {
    const file = new File(['hello'], 'notes.md');
    const promise = uploadFileToConvexStorage('https://upload.example', file);

    xhr.handlers.onerror?.();

    await expect(promise).rejects.toThrow('Failed to upload file');
  });
});
