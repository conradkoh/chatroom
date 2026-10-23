/**
 * `chatroom remove-image-background-fal` unit tests.
 *
 * Every dependency is injected, so these tests never touch the network, the
 * real filesystem, or a paid fal call. The PNG fixture is built in memory from
 * the signature and IHDR header, which is all the preflight checks read.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  FAL_BACKGROUND_MODE,
  FAL_BACKGROUND_MODEL,
  MAX_FAL_INPUT_BYTES,
  MAX_FAL_RESULT_BYTES,
  removeBackgroundFal,
  validateBackgroundResult,
  type RemoveBackgroundFalDeps,
} from './remove-background-fal.js';

vi.mock('@fal-ai/client', () => {
  throw new Error('must not load fal');
});

const FAL_API_KEY = 'fal-key-sentinel-never-printed';
const IN_PATH = '/tiles/potion.png';
const OUT_PATH = '/assets/potion.png';
const IMAGE_URL = 'https://fal.test/cutout.png';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Minimal PNG header: signature, IHDR length/type, width, and height. */
function pngBytes(width = 8, height = 8): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set(PNG_SIGNATURE, 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8;
  bytes[25] = 6;
  return bytes;
}

function result(overrides: Record<string, unknown> = {}): unknown {
  return {
    requestId: 'req-1',
    data: { image: { url: IMAGE_URL } },
    ...overrides,
  };
}

function createDeps(overrides: Partial<RemoveBackgroundFalDeps> = {}): RemoveBackgroundFalDeps {
  return {
    env: { FAL_API_KEY },
    falSubscribe: vi.fn().mockResolvedValue(result()),
    fetchBytes: vi.fn().mockResolvedValue(pngBytes()),
    readInput: vi.fn().mockResolvedValue(pngBytes()),
    statInput: vi.fn().mockResolvedValue({ size: 33 }),
    pathStatus: vi.fn(async (path: string) => (path === IN_PATH ? 'file' : 'missing')),
    writeFile: vi.fn().mockResolvedValue(undefined),
    writeJson: vi.fn().mockResolvedValue(undefined),
    ensureParentDir: vi.fn().mockResolvedValue(undefined),
    now: () => new Date('2026-10-23T01:02:03.000Z'),
    sdkVersion: '1.10.1',
    ...overrides,
  };
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected the call to reject');
}

describe('removeBackgroundFal', () => {
  it('sends a BiRefNet data-URI request and writes the PNG and manifest', async () => {
    const source = pngBytes(16, 12);
    const output = pngBytes(16, 12);
    const deps = createDeps({
      readInput: vi.fn().mockResolvedValue(source),
      fetchBytes: vi.fn().mockResolvedValue(output),
    });

    const saved = await removeBackgroundFal({ in: IN_PATH, out: OUT_PATH }, deps);

    const expectedDataUri = `data:image/png;base64,${Buffer.from(source).toString('base64')}`;
    expect(deps.falSubscribe).toHaveBeenCalledWith(FAL_BACKGROUND_MODEL, {
      image_url: expectedDataUri,
      model: 'Matting',
      output_format: 'png',
    });
    expect(deps.fetchBytes).toHaveBeenCalledWith(IMAGE_URL);
    expect(deps.ensureParentDir).toHaveBeenCalledWith(OUT_PATH);
    expect(deps.writeFile).toHaveBeenCalledWith(OUT_PATH, output);
    expect(saved).toMatchObject({
      outPath: OUT_PATH,
      manifestPath: `${OUT_PATH}.json`,
      requestId: 'req-1',
      bytes: output.byteLength,
    });
    expect(deps.writeJson).toHaveBeenCalledTimes(1);

    const manifest = vi.mocked(deps.writeJson).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(manifest).toMatchObject({
      platform: 'fal',
      tool: 'chatroom remove-image-background-fal',
      sdk: '@fal-ai/client@1.10.1',
      model: 'fal-ai/birefnet/v2',
      input: {
        mode: 'Matting',
        output_format: 'png',
        source: 'potion.png',
        sourceBytes: source.byteLength,
      },
      requestId: 'req-1',
      output: {
        path: OUT_PATH,
        bytes: output.byteLength,
        contentType: 'image/png',
      },
      generatedAt: '2026-10-23T01:02:03.000Z',
      licensing: 'unverified',
    });
    expect(JSON.stringify(manifest).includes(FAL_API_KEY)).toBe(false);
    expect(JSON.stringify(manifest).includes('data:image/png;base64,')).toBe(false);
  });

  it('rejects a missing FAL_API_KEY before touching the source or fal', async () => {
    const deps = createDeps({ env: {} });

    const error = await captureError(removeBackgroundFal({ in: IN_PATH, out: OUT_PATH }, deps));

    expect(error.message).toContain('FAL_API_KEY is not set');
    expect(deps.statInput).not.toHaveBeenCalled();
    expect(deps.falSubscribe).not.toHaveBeenCalled();
    expect(deps.fetchBytes).not.toHaveBeenCalled();
  });

  it('rejects an existing output without --force before the paid call', async () => {
    const deps = createDeps({
      pathStatus: vi.fn(async () => 'file' as const),
    });

    const error = await captureError(removeBackgroundFal({ in: IN_PATH, out: OUT_PATH }, deps));

    expect(error.message).toBe(`Output already exists: ${OUT_PATH}. Pass --force to overwrite.`);
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('overwrites an existing output with --force', async () => {
    const deps = createDeps({ pathStatus: vi.fn().mockResolvedValue('file') });

    await removeBackgroundFal({ in: IN_PATH, out: OUT_PATH, force: true }, deps);

    expect(deps.falSubscribe).toHaveBeenCalledTimes(1);
    expect(deps.writeFile).toHaveBeenCalledWith(OUT_PATH, expect.any(Uint8Array));
  });

  it('rejects a missing input before the paid call', async () => {
    const deps = createDeps({
      pathStatus: vi.fn(async () => 'missing' as const),
    });

    const error = await captureError(removeBackgroundFal({ in: IN_PATH, out: OUT_PATH }, deps));

    expect(error.message).toBe(`Input not found: ${IN_PATH}`);
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('rejects an input larger than the fal cap before the paid call', async () => {
    const deps = createDeps({
      statInput: vi.fn().mockResolvedValue({ size: MAX_FAL_INPUT_BYTES + 1 }),
    });

    const error = await captureError(removeBackgroundFal({ in: IN_PATH, out: OUT_PATH }, deps));

    expect(error.message).toContain(`maximum fal input is ${MAX_FAL_INPUT_BYTES} bytes`);
    expect(deps.readInput).not.toHaveBeenCalled();
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('rejects bytes that grew past the cap between stat and read', async () => {
    const deps = createDeps({
      readInput: vi.fn().mockResolvedValue(new Uint8Array(MAX_FAL_INPUT_BYTES + 1)),
    });

    const error = await captureError(removeBackgroundFal({ in: IN_PATH, out: OUT_PATH }, deps));

    expect(error.message).toContain('maximum fal input');
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('rejects a non-PNG input before the paid call', async () => {
    const deps = createDeps({ readInput: vi.fn().mockResolvedValue(new Uint8Array(64)) });

    const error = await captureError(removeBackgroundFal({ in: IN_PATH, out: OUT_PATH }, deps));

    expect(error.message).toBe(`${IN_PATH} is not a PNG.`);
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('rejects an image over the pixel cap before the paid call', async () => {
    const deps = createDeps({ readInput: vi.fn().mockResolvedValue(pngBytes(20_000, 20_000)) });

    const error = await captureError(removeBackgroundFal({ in: IN_PATH, out: OUT_PATH }, deps));

    expect(error.message).toContain('the maximum is 100000000 pixels');
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it.each([
    ['no data', { requestId: 'req-1' }],
    ['no image', { requestId: 'req-1', data: {} }],
    ['no url', { requestId: 'req-1', data: { image: {} } }],
    ['insecure url', { requestId: 'req-1', data: { image: { url: 'http://fal.test/x.png' } } }],
    ['no requestId', { data: { image: { url: IMAGE_URL } } }],
    ['not an object', 'nope'],
  ])('rejects a result with %s and writes nothing', async (_label, raw) => {
    const deps = createDeps({ falSubscribe: vi.fn().mockResolvedValue(raw) });

    const error = await captureError(removeBackgroundFal({ in: IN_PATH, out: OUT_PATH }, deps));

    expect(error.message).toContain('fal returned no image for fal-ai/birefnet/v2');
    expect(deps.fetchBytes).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.writeJson).not.toHaveBeenCalled();
  });

  it('rejects a downloaded result larger than the cap without writing', async () => {
    const deps = createDeps({
      fetchBytes: vi.fn().mockResolvedValue(new Uint8Array(MAX_FAL_RESULT_BYTES + 1)),
    });

    const error = await captureError(removeBackgroundFal({ in: IN_PATH, out: OUT_PATH }, deps));

    expect(error.message).toContain(`maximum is ${MAX_FAL_RESULT_BYTES} bytes`);
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.writeJson).not.toHaveBeenCalled();
  });

  it('rejects a downloaded result that is not a PNG without writing', async () => {
    const deps = createDeps({
      fetchBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
    });

    const error = await captureError(removeBackgroundFal({ in: IN_PATH, out: OUT_PATH }, deps));

    expect(error.message).toContain('Downloaded file is not a PNG');
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.writeJson).not.toHaveBeenCalled();
  });

  it('names the request id and url when the download fails', async () => {
    const deps = createDeps({
      fetchBytes: vi.fn().mockRejectedValue(new Error('HTTP 500')),
    });

    const error = await captureError(removeBackgroundFal({ in: IN_PATH, out: OUT_PATH }, deps));

    expect(error.message).toContain('Failed to download image for request req-1');
    expect(error.message).toContain(IMAGE_URL);
    expect(error.message).toContain('HTTP 500');
    expect(deps.writeFile).not.toHaveBeenCalled();
  });
});

describe('validateBackgroundResult', () => {
  it('narrows a BiRefNet result to the image url', () => {
    expect(validateBackgroundResult(result())).toEqual({
      requestId: 'req-1',
      data: { image: { url: IMAGE_URL } },
    });
    expect(FAL_BACKGROUND_MODE).toBe('Matting');
    expect(FAL_BACKGROUND_MODEL).toBe('fal-ai/birefnet/v2');
  });
});
