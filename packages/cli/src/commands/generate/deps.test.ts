/**
 * Generate Deps Unit Tests
 *
 * Exercises the fal adapter with a mocked `fal.subscribe` and a mocked global
 * `fetch`. The real `ApiError`/`ValidationError` classes are kept so error
 * mapping is tested against the SDK's actual shapes. No network calls are made.
 */

import { ApiError, ValidationError } from '@fal-ai/client';
import type * as FalModule from '@fal-ai/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultGenerateImageDeps } from './deps.js';
import type { GenerateImageDeps } from './deps.js';

const { subscribeMock, configMock } = vi.hoisted(() => ({
  subscribeMock: vi.fn(),
  configMock: vi.fn(),
}));

vi.mock('@fal-ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof FalModule>();
  return { ...actual, fal: { ...actual.fal, subscribe: subscribeMock, config: configMock } };
});

const FAL_API_KEY = 'fal-api-key-sentinel-never-printed';
const IMAGE_URL = 'https://fal.test/generated/hero.png';

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected the call to reject');
}

describe('createDefaultGenerateImageDeps', () => {
  let deps: GenerateImageDeps;

  beforeEach(() => {
    process.env.FAL_API_KEY = FAL_API_KEY;
    subscribeMock.mockReset();
    configMock.mockReset();
    deps = createDefaultGenerateImageDeps();
  });

  afterEach(() => {
    delete process.env.FAL_API_KEY;
    vi.unstubAllGlobals();
  });

  it('reports the installed SDK version', () => {
    expect(deps.sdkVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('subscribes with logs disabled, a 300s timeout, and validates the result', async () => {
    subscribeMock.mockResolvedValue({
      data: { images: [{ url: IMAGE_URL, content_type: 'image/png' }] },
      requestId: 'req-1',
    });

    await expect(deps.falSubscribe('fal-ai/flux/dev', { prompt: 'x' })).resolves.toEqual({
      data: { images: [{ url: IMAGE_URL, content_type: 'image/png' }] },
      requestId: 'req-1',
    });
    expect(subscribeMock).toHaveBeenCalledWith('fal-ai/flux/dev', {
      input: { prompt: 'x' },
      logs: false,
      startTimeout: 300,
    });
  });

  it('passes FAL_API_KEY to the SDK credentials explicitly without leaking it', async () => {
    subscribeMock.mockResolvedValue({
      data: { images: [{ url: IMAGE_URL }] },
      requestId: 'req-1',
    });

    await deps.falSubscribe('fal-ai/flux/dev', { prompt: 'x' });

    expect(configMock).toHaveBeenCalledWith({ credentials: FAL_API_KEY });

    subscribeMock.mockRejectedValue(
      new ApiError({ message: 'Bad Request', status: 400, body: {}, requestId: 'req-400' })
    );
    const error = await captureError(deps.falSubscribe('fal-ai/flux/dev', { prompt: 'x' }));
    expect(error.message.includes(FAL_API_KEY)).toBe(false);
  });

  it('refuses to call the SDK when FAL_API_KEY is missing', async () => {
    delete process.env.FAL_API_KEY;
    const keylessDeps = createDefaultGenerateImageDeps();

    await expect(keylessDeps.falSubscribe('fal-ai/flux/dev', { prompt: 'x' })).rejects.toThrow(
      'FAL_API_KEY is not set'
    );
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

    const error = await captureError(deps.falSubscribe('fal-ai/flux/dev', { prompt: 'x' }));

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

    const error = await captureError(deps.falSubscribe('fal-ai/flux/dev', { prompt: 'x' }));

    expect(error.message).toContain('HTTP 400');
    expect(error.message).toContain('invalid model id');
    expect(error.message).toContain('req-400');
    expect(error.message.includes(FAL_API_KEY)).toBe(false);
  });

  it('rejects a result whose data.images is not an array', async () => {
    subscribeMock.mockResolvedValue({ data: {}, requestId: 'req-bad' });

    await expect(deps.falSubscribe('fal-ai/flux/dev', { prompt: 'x' })).rejects.toThrow(
      'fal returned an unexpected result: data.images is not an array'
    );
  });

  it('rejects a result without a requestId', async () => {
    subscribeMock.mockResolvedValue({ data: { images: [] } });

    await expect(deps.falSubscribe('fal-ai/flux/dev', { prompt: 'x' })).rejects.toThrow(
      'requestId is missing'
    );
  });

  it('rejects an image entry without a url', async () => {
    subscribeMock.mockResolvedValue({
      data: { images: [{ content_type: 'image/png' }] },
      requestId: 'req-bad',
    });

    await expect(deps.falSubscribe('fal-ai/flux/dev', { prompt: 'x' })).rejects.toThrow(
      'image entry is missing a url'
    );
  });

  it('treats null optional image metadata as absent', async () => {
    subscribeMock.mockResolvedValue({
      data: { images: [{ url: IMAGE_URL, file_name: null, content_type: null }] },
      requestId: 'req-ok',
    });

    await expect(deps.falSubscribe('fal-ai/flux/dev', { prompt: 'x' })).resolves.toEqual({
      requestId: 'req-ok',
      data: { images: [{ url: IMAGE_URL }] },
    });
  });

  it('rejects a non-numeric seed', async () => {
    subscribeMock.mockResolvedValue({
      data: { images: [{ url: IMAGE_URL }], seed: 'not-a-number' },
      requestId: 'req-bad',
    });

    await expect(deps.falSubscribe('fal-ai/flux/dev', { prompt: 'x' })).rejects.toThrow(
      'seed is not a number'
    );
  });

  it('rejects a non-OK download with the HTTP status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' })
    );

    await expect(deps.fetchBytes(IMAGE_URL)).rejects.toThrow('HTTP 500 Server Error');
  });

  it('rejects a download whose content-type is not an image', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'text/html; charset=utf-8' },
        arrayBuffer: async () => new ArrayBuffer(0),
      })
    );

    await expect(deps.fetchBytes(IMAGE_URL)).rejects.toThrow('content-type: text/html');
  });

  it('returns the downloaded bytes for an image response', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () => bytes.buffer,
      })
    );

    await expect(deps.fetchBytes(IMAGE_URL)).resolves.toEqual(bytes);
  });
});
