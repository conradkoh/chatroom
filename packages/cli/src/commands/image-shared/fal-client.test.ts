/**
 * Shared fal Client Unit Tests
 *
 * Exercises the shared fal adapter with a mocked `fal.subscribe`/`fal.storage`
 * and a temporary directory. The real `ApiError`/`ValidationError` classes are
 * kept so error mapping is tested against the SDK's actual shapes. No network
 * calls are made.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type * as FalModule from '@fal-ai/client';
import { ApiError, ValidationError } from '@fal-ai/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FalClientError, createFalRawSubscribe, createFalUploadFile } from './fal-client.js';

const { subscribeMock, configMock, uploadMock } = vi.hoisted(() => ({
  subscribeMock: vi.fn(),
  configMock: vi.fn(),
  uploadMock: vi.fn(),
}));

vi.mock('@fal-ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof FalModule>();
  return {
    ...actual,
    fal: {
      ...actual.fal,
      subscribe: subscribeMock,
      config: configMock,
      storage: { ...actual.fal.storage, upload: uploadMock },
    },
  };
});

const FAL_API_KEY = 'fal-api-key-sentinel-never-printed';
const IMAGE_URL = 'https://fal.test/generated/hero.png';
const UPLOADED_URL = 'https://fal.test/uploaded/hero.png';

/** Temp dirs created by a test, removed in afterEach. */
const tempDirs: string[] = [];

/** Write bytes to a fresh temp file and return its absolute path. */
async function writeTempFile(bytes: Uint8Array, name = 'input.png'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'chatroom-upload-'));
  tempDirs.push(dir);
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected the call to reject');
}

describe('createFalRawSubscribe', () => {
  beforeEach(() => {
    process.env.FAL_API_KEY = FAL_API_KEY;
    subscribeMock.mockReset();
    configMock.mockReset();
  });

  afterEach(() => {
    delete process.env.FAL_API_KEY;
  });

  it('returns the raw result without narrowing it', async () => {
    const raw = { data: { image: { url: IMAGE_URL } }, requestId: 'req-raw' };
    subscribeMock.mockResolvedValue(raw);

    const subscribe = createFalRawSubscribe(process.env);

    await expect(
      subscribe('fal-ai/birefnet/v2', { image_url: 'data:image/png;base64,AA==' })
    ).resolves.toEqual(raw);
    expect(subscribeMock).toHaveBeenCalledWith('fal-ai/birefnet/v2', {
      input: { image_url: 'data:image/png;base64,AA==' },
      logs: false,
      startTimeout: 300,
    });
  });

  it('passes FAL_API_KEY to the SDK credentials explicitly without leaking it', async () => {
    subscribeMock.mockResolvedValue({ data: { image: { url: IMAGE_URL } }, requestId: 'req-1' });

    const subscribe = createFalRawSubscribe(process.env);
    await subscribe('fal-ai/flux/dev', { prompt: 'x' });

    expect(configMock).toHaveBeenCalledWith({ credentials: FAL_API_KEY });

    subscribeMock.mockRejectedValue(
      new ApiError({ message: 'Bad Request', status: 400, body: {}, requestId: 'req-400' })
    );
    const error = await captureError(subscribe('fal-ai/flux/dev', { prompt: 'x' }));
    expect(error.message.includes(FAL_API_KEY)).toBe(false);
  });

  it('refuses to call the SDK when FAL_API_KEY is missing', async () => {
    delete process.env.FAL_API_KEY;
    const subscribe = createFalRawSubscribe(process.env);

    const error = await captureError(subscribe('fal-ai/flux/dev', { prompt: 'x' }));

    expect(error).toBeInstanceOf(FalClientError);
    expect(error.message).toContain('FAL_API_KEY is not set');
    expect(configMock).not.toHaveBeenCalled();
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it('surfaces validation field errors, status and requestId', async () => {
    subscribeMock.mockRejectedValue(
      new ValidationError({
        message: 'Unprocessable Entity',
        status: 422,
        body: {
          detail: [
            { loc: ['prompt'], msg: 'String should have at most 1000 chars', type: 'value_error' },
          ],
        },
        requestId: 'req-422',
      })
    );

    const subscribe = createFalRawSubscribe(process.env);
    const error = await captureError(subscribe('fal-ai/flux/dev', { prompt: 'x' }));

    expect(error).toBeInstanceOf(FalClientError);
    expect(error.message).toContain('HTTP 422');
    expect(error.message).toContain('prompt: String should have at most 1000 chars');
    expect(error.message).toContain('req-422');
    expect(error.message.includes(FAL_API_KEY)).toBe(false);
  });

  it('surfaces ApiError body messages and requestId', async () => {
    subscribeMock.mockRejectedValue(
      new ApiError({
        message: 'Bad Request',
        status: 400,
        body: { message: 'invalid model id' },
        requestId: 'req-400',
      })
    );

    const subscribe = createFalRawSubscribe(process.env);
    const error = await captureError(subscribe('fal-ai/flux/dev', { prompt: 'x' }));

    expect(error).toBeInstanceOf(FalClientError);
    expect(error.message).toContain('HTTP 400');
    expect(error.message).toContain('invalid model id');
    expect(error.message).toContain('req-400');
    expect(error.message.includes(FAL_API_KEY)).toBe(false);
  });
});

describe('createFalUploadFile', () => {
  beforeEach(() => {
    process.env.FAL_API_KEY = FAL_API_KEY;
    configMock.mockReset();
    uploadMock.mockReset();
  });

  afterEach(async () => {
    delete process.env.FAL_API_KEY;
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('uploads a file with its content type and a one-day lifetime', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const path = await writeTempFile(bytes);
    uploadMock.mockResolvedValue(UPLOADED_URL);

    const upload = createFalUploadFile(process.env);
    await expect(upload(path, 'image/png')).resolves.toBe(UPLOADED_URL);

    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [blob, options] = uploadMock.mock.calls[0] as [Blob, unknown];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    expect(options).toEqual({ lifecycle: { expiresIn: '1d' } });
    expect(configMock).toHaveBeenCalledWith({ credentials: FAL_API_KEY });
  });

  it('wraps an ApiError upload rejection', async () => {
    const path = await writeTempFile(new Uint8Array([1, 2, 3]));
    uploadMock.mockRejectedValue(
      new ApiError({
        message: 'Bad Request',
        status: 400,
        body: { message: 'upload denied' },
        requestId: 'req-upload-400',
      })
    );

    const upload = createFalUploadFile(process.env);
    const error = await captureError(upload(path, 'image/png'));

    expect(error).toBeInstanceOf(FalClientError);
    expect(error.message.startsWith(`Failed to upload input image ${path}`)).toBe(true);
    expect(error.message).toContain('HTTP 400');
    expect(error.message).toContain('upload denied');
    expect(error.message).toContain('req-upload-400');
    expect(error.message.includes(FAL_API_KEY)).toBe(false);
  });

  it('wraps a ValidationError upload rejection', async () => {
    const path = await writeTempFile(new Uint8Array([1, 2, 3]));
    uploadMock.mockRejectedValue(
      new ValidationError({
        message: 'Unprocessable Entity',
        status: 422,
        body: {
          detail: [{ loc: ['file'], msg: 'File too large', type: 'value_error' }],
        },
        requestId: 'req-upload-422',
      })
    );

    const upload = createFalUploadFile(process.env);
    const error = await captureError(upload(path, 'image/png'));

    expect(error).toBeInstanceOf(FalClientError);
    expect(error.message.startsWith(`Failed to upload input image ${path}`)).toBe(true);
    expect(error.message).toContain('HTTP 422');
    expect(error.message).toContain('file: File too large');
    expect(error.message).toContain('req-upload-422');
    expect(error.message.includes(FAL_API_KEY)).toBe(false);
  });

  it('refuses to upload without FAL_API_KEY before reading the file', async () => {
    delete process.env.FAL_API_KEY;
    const upload = createFalUploadFile(process.env);

    const error = await captureError(upload('/no/such/file.png', 'image/png'));

    expect(error).toBeInstanceOf(FalClientError);
    expect(error.message).toContain('FAL_API_KEY is not set');
    expect(configMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('wraps a read failure in FalClientError', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'chatroom-upload-dir-'));
    tempDirs.push(dir);

    const upload = createFalUploadFile(process.env);
    const error = await captureError(upload(dir, 'image/png'));

    expect(error).toBeInstanceOf(FalClientError);
    expect(error.message.startsWith(`Failed to upload input image ${dir}`)).toBe(true);
    expect(uploadMock).not.toHaveBeenCalled();
  });
});
