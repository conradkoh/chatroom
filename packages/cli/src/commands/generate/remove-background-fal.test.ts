/**
 * `chatroom remove-image-background-fal` unit tests.
 *
 * Every dependency is injected, so these tests never touch the network, the
 * real filesystem, or a paid fal call. The PNG fixture is built in memory from
 * the signature and IHDR header, which is all the preflight checks read.
 */

import { describe, expect, it, vi } from 'vitest';

import { LIST_PRICES, type FalUnitPrice } from './fal-pricing.js';
import type { PathStatus } from './fs-helpers.js';
import {
  DEFAULT_BACKGROUND_ENGINE,
  MAX_FAL_INPUT_BYTES,
  MAX_FAL_RESULT_BYTES,
  removeBackgroundFal,
  validateBackgroundResult,
  type BackgroundEngine,
  type RemoveBackgroundFalDeps,
} from './remove-background-fal.js';

vi.mock('@fal-ai/client', () => {
  throw new Error('must not load fal');
});

const FAL_API_KEY = 'fal-key-sentinel-never-printed';
const IN_PATH = '/tiles/potion.png';
const OUT_PATH = '/assets/potion.png';
const IMAGE_URL = 'https://fal.test/cutout.png';
const BRIA_MODEL = 'fal-ai/bria/background/remove';
const BIFNET_MODEL = 'fal-ai/birefnet/v2';

const ENGINES: { engine: BackgroundEngine; model: string }[] = [
  { engine: 'bria', model: BRIA_MODEL },
  { engine: 'birefnet', model: BIFNET_MODEL },
];

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

function listPrices(endpointIds: readonly string[]): Map<string, FalUnitPrice> {
  const prices = new Map<string, FalUnitPrice>();
  for (const endpointId of endpointIds) {
    const fallback = LIST_PRICES[endpointId];
    if (fallback !== undefined) {
      prices.set(endpointId, { endpointId, ...fallback, rateSource: 'list' });
    }
  }
  return prices;
}

function createDeps(overrides: Partial<RemoveBackgroundFalDeps> = {}): RemoveBackgroundFalDeps {
  return {
    env: { FAL_API_KEY },
    falSubscribe: vi.fn().mockResolvedValue(result()),
    lookupPrices: vi.fn(async (ids: readonly string[]) => listPrices(ids)),
    fetchBytes: vi.fn().mockResolvedValue(pngBytes()),
    readInput: vi.fn().mockResolvedValue(pngBytes()),
    statInput: vi.fn().mockResolvedValue({ kind: 'file', size: 33 }),
    pathStatus: vi.fn(async (path: string) => (path === IN_PATH ? 'file' : 'missing')),
    writeFile: vi.fn().mockResolvedValue(undefined),
    writeJson: vi.fn().mockResolvedValue(undefined),
    ensureParentDir: vi.fn().mockResolvedValue(undefined),
    now: () => new Date('2026-10-23T01:02:03.000Z'),
    sdkVersion: '1.10.1',
    log: vi.fn(),
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

/** pathStatus fake backed by an explicit map; anything unlisted is missing. */
function pathStatusFor(entries: Record<string, PathStatus>): RemoveBackgroundFalDeps['pathStatus'] {
  return vi.fn(async (path: string) => entries[path] ?? 'missing');
}

describe('removeBackgroundFal', () => {
  it('defaults to bria and sends only image_url', async () => {
    const source = pngBytes(16, 12);
    const output = pngBytes(16, 12);
    const deps = createDeps({
      readInput: vi.fn().mockResolvedValue(source),
      fetchBytes: vi.fn().mockResolvedValue(output),
    });

    const saved = await removeBackgroundFal({ in: IN_PATH, out: OUT_PATH }, deps);

    const expectedDataUri = `data:image/png;base64,${Buffer.from(source).toString('base64')}`;
    expect(DEFAULT_BACKGROUND_ENGINE).toBe('bria');
    expect(deps.falSubscribe).toHaveBeenCalledWith(BRIA_MODEL, {
      image_url: expectedDataUri,
    });
    const request = vi.mocked(deps.falSubscribe).mock.calls[0]?.[1] ?? {};
    expect(Object.keys(request)).toEqual(['image_url']);
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
      engine: 'bria',
      model: BRIA_MODEL,
      input: {
        source: 'potion.png',
        sourceBytes: source.byteLength,
        width: 16,
        height: 12,
      },
      requestId: 'req-1',
      output: {
        path: OUT_PATH,
        bytes: output.byteLength,
        contentType: 'image/png',
        width: 16,
        height: 12,
      },
      generatedAt: '2026-10-23T01:02:03.000Z',
      licensing: 'unverified',
    });
    expect((manifest.input as Record<string, unknown>).mode).toBeUndefined();
    expect((manifest.input as Record<string, unknown>).output_format).toBeUndefined();
    expect(JSON.stringify(manifest).includes(FAL_API_KEY)).toBe(false);
    expect(JSON.stringify(manifest).includes('data:image/png;base64,')).toBe(false);
  });

  it('sends the BiRefNet Matting input for --engine birefnet', async () => {
    const source = pngBytes(16, 12);
    const deps = createDeps({
      readInput: vi.fn().mockResolvedValue(source),
      fetchBytes: vi.fn().mockResolvedValue(pngBytes(16, 12)),
    });

    await removeBackgroundFal({ in: IN_PATH, out: OUT_PATH, engine: 'birefnet' }, deps);

    const expectedDataUri = `data:image/png;base64,${Buffer.from(source).toString('base64')}`;
    expect(deps.falSubscribe).toHaveBeenCalledWith(BIFNET_MODEL, {
      image_url: expectedDataUri,
      model: 'Matting',
      output_format: 'png',
    });

    const manifest = vi.mocked(deps.writeJson).mock.calls[0]?.[1] as {
      engine: string;
      model: string;
      input: Record<string, unknown>;
    };
    expect(manifest.engine).toBe('birefnet');
    expect(manifest.model).toBe(BIFNET_MODEL);
    expect(manifest.input).toMatchObject({ mode: 'Matting', output_format: 'png' });
  });

  it.each(ENGINES)(
    'writes a $engine result whose dimensions match the input',
    async ({ engine }) => {
      const source = pngBytes(16, 12);
      const download = pngBytes(16, 12);
      const deps = createDeps({
        readInput: vi.fn().mockResolvedValue(source),
        fetchBytes: vi.fn().mockResolvedValue(download),
      });

      await removeBackgroundFal({ in: IN_PATH, out: OUT_PATH, engine }, deps);

      expect(deps.writeFile).toHaveBeenCalledWith(OUT_PATH, download);
      const manifest = vi.mocked(deps.writeJson).mock.calls[0]?.[1] as {
        input: Record<string, unknown>;
        output: Record<string, unknown>;
      };
      expect(manifest.input).toMatchObject({ width: 16, height: 12 });
      expect(manifest.output).toMatchObject({ width: 16, height: 12 });
    }
  );

  it('rejects a result whose dimensions differ from the input before writing', async () => {
    const deps = createDeps({
      readInput: vi.fn().mockResolvedValue(pngBytes(8, 8)),
      fetchBytes: vi.fn().mockResolvedValue(pngBytes(9, 8)),
    });

    const error = await captureError(removeBackgroundFal({ in: IN_PATH, out: OUT_PATH }, deps));

    expect(error.message).toContain('request req-1');
    expect(error.message).toContain(IMAGE_URL);
    expect(error.message).toContain('result is 9x8');
    expect(error.message).toContain('input is 8x8');
    expect(error.message).toContain(OUT_PATH);
    expect(error.message).toContain('--engine birefnet');
    expect(deps.falSubscribe).toHaveBeenCalledTimes(1);
    expect(deps.ensureParentDir).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.writeJson).not.toHaveBeenCalled();
  });

  it.each(ENGINES)(
    'rejects an unreadable $engine result PNG before writing',
    async ({ engine }) => {
      // PNG magic alone is not a decodable header, so readPngDimensions returns null.
      const deps = createDeps({
        fetchBytes: vi.fn().mockResolvedValue(new Uint8Array([...PNG_SIGNATURE, 1, 2, 3])),
      });

      const error = await captureError(
        removeBackgroundFal({ in: IN_PATH, out: OUT_PATH, engine }, deps)
      );

      expect(error.message).toContain('could not read the result PNG dimensions');
      expect(error.message).toContain('input is 8x8');
      expect(deps.ensureParentDir).not.toHaveBeenCalled();
      expect(deps.writeFile).not.toHaveBeenCalled();
      expect(deps.writeJson).not.toHaveBeenCalled();
    }
  );

  it('rejects a missing FAL_API_KEY before touching the source or fal', async () => {
    const deps = createDeps({ env: {} });

    const error = await captureError(removeBackgroundFal({ in: IN_PATH, out: OUT_PATH }, deps));

    expect(error.message).toContain('FAL_API_KEY is not set');
    expect(deps.pathStatus).not.toHaveBeenCalled();
    expect(deps.statInput).not.toHaveBeenCalled();
    expect(deps.readInput).not.toHaveBeenCalled();
    expect(deps.falSubscribe).not.toHaveBeenCalled();
    expect(deps.fetchBytes).not.toHaveBeenCalled();
  });

  it('rejects an existing output without --force before the paid call', async () => {
    const deps = createDeps({
      pathStatus: vi.fn(async () => 'file' as const),
    });

    const error = await captureError(removeBackgroundFal({ in: IN_PATH, out: OUT_PATH }, deps));

    expect(error.message).toBe(`--out already exists: ${OUT_PATH}. Pass --force to overwrite.`);
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('overwrites an existing output with --force', async () => {
    const deps = createDeps({ pathStatus: vi.fn().mockResolvedValue('file') });

    await removeBackgroundFal({ in: IN_PATH, out: OUT_PATH, force: true }, deps);

    expect(deps.falSubscribe).toHaveBeenCalledTimes(1);
    expect(deps.writeFile).toHaveBeenCalledWith(OUT_PATH, expect.any(Uint8Array));
  });

  it('rejects an existing manifest without --force before the paid call', async () => {
    const deps = createDeps({
      pathStatus: pathStatusFor({ [OUT_PATH]: 'missing', [`${OUT_PATH}.json`]: 'file' }),
    });

    const error = await captureError(removeBackgroundFal({ in: IN_PATH, out: OUT_PATH }, deps));

    expect(error.message).toBe(
      `Manifest already exists: ${OUT_PATH}.json. Pass --force to overwrite.`
    );
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('rejects a manifest path that is a directory before the paid call', async () => {
    const deps = createDeps({
      pathStatus: pathStatusFor({ [OUT_PATH]: 'missing', [`${OUT_PATH}.json`]: 'directory' }),
    });

    const error = await captureError(removeBackgroundFal({ in: IN_PATH, out: OUT_PATH }, deps));

    expect(error.message).toBe(`Manifest is a directory: ${OUT_PATH}.json. Pass a file path.`);
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('overwrites an existing manifest with --force', async () => {
    const deps = createDeps({
      pathStatus: pathStatusFor({ [OUT_PATH]: 'file', [`${OUT_PATH}.json`]: 'file' }),
    });

    await removeBackgroundFal({ in: IN_PATH, out: OUT_PATH, force: true }, deps);

    expect(deps.falSubscribe).toHaveBeenCalledTimes(1);
    expect(deps.writeJson).toHaveBeenCalledWith(`${OUT_PATH}.json`, expect.any(Object));
  });

  it('rejects an --out path that is a directory before the paid call', async () => {
    const deps = createDeps({ pathStatus: pathStatusFor({ [OUT_PATH]: 'directory' }) });

    const error = await captureError(removeBackgroundFal({ in: IN_PATH, out: OUT_PATH }, deps));

    expect(error.message).toBe(`--out is a directory: ${OUT_PATH}. Pass a file path.`);
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('surfaces a fal failure and writes nothing', async () => {
    const deps = createDeps({
      falSubscribe: vi.fn().mockRejectedValue(new Error('fal request failed (HTTP 500)')),
    });

    const error = await captureError(removeBackgroundFal({ in: IN_PATH, out: OUT_PATH }, deps));

    expect(error.message).toContain('fal request failed (HTTP 500)');
    expect(deps.fetchBytes).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.writeJson).not.toHaveBeenCalled();
  });

  it('names the request id and output path when the manifest write fails', async () => {
    const deps = createDeps({
      writeJson: vi.fn().mockRejectedValue(new Error('EISDIR: illegal operation on a directory')),
    });

    const error = await captureError(removeBackgroundFal({ in: IN_PATH, out: OUT_PATH }, deps));

    expect(error.message).toContain(`Failed to save manifest ${OUT_PATH}.json`);
    expect(error.message).toContain('request req-1');
    expect(error.message).toContain(OUT_PATH);
    expect(error.message).toContain('EISDIR');
  });

  it('rejects a missing input before the paid call', async () => {
    const deps = createDeps({
      statInput: vi.fn().mockResolvedValue({ kind: 'missing', size: 0 }),
    });

    const error = await captureError(removeBackgroundFal({ in: IN_PATH, out: OUT_PATH }, deps));

    expect(error.message).toBe(`Input not found: ${IN_PATH}`);
    expect(deps.readInput).not.toHaveBeenCalled();
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('rejects a non-regular input before reading it or calling fal', async () => {
    const deps = createDeps({
      statInput: vi.fn().mockResolvedValue({ kind: 'other', size: 0 }),
    });

    const error = await captureError(removeBackgroundFal({ in: IN_PATH, out: OUT_PATH }, deps));

    expect(error.message).toBe(`Input is not a regular file: ${IN_PATH}.`);
    expect(deps.readInput).not.toHaveBeenCalled();
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('rejects the same --in and --out path before the paid call', async () => {
    const deps = createDeps();

    const error = await captureError(removeBackgroundFal({ in: OUT_PATH, out: OUT_PATH }, deps));

    expect(error.message).toBe(
      `--in and --out are the same file: ${OUT_PATH}. Choose a different output path.`
    );
    expect(deps.statInput).not.toHaveBeenCalled();
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('rejects an input larger than the fal cap before the paid call', async () => {
    const deps = createDeps({
      statInput: vi.fn().mockResolvedValue({ kind: 'file', size: MAX_FAL_INPUT_BYTES + 1 }),
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

  it.each(ENGINES)(
    'rejects malformed $engine results and writes nothing',
    async ({ engine, model }) => {
      const deps = createDeps({ falSubscribe: vi.fn().mockResolvedValue({ requestId: 'req-1' }) });

      const error = await captureError(
        removeBackgroundFal({ in: IN_PATH, out: OUT_PATH, engine }, deps)
      );

      expect(error.message).toContain(`fal returned no image for ${model}`);
      expect(deps.fetchBytes).not.toHaveBeenCalled();
      expect(deps.writeFile).not.toHaveBeenCalled();
      expect(deps.writeJson).not.toHaveBeenCalled();
    }
  );

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

    expect(error.message).toContain(`fal returned no image for ${BRIA_MODEL}`);
    expect(deps.fetchBytes).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.writeJson).not.toHaveBeenCalled();
  });

  it.each(ENGINES)('rejects an oversized $engine download without writing', async ({ engine }) => {
    const deps = createDeps({
      fetchBytes: vi.fn().mockResolvedValue(new Uint8Array(MAX_FAL_RESULT_BYTES + 1)),
    });

    const error = await captureError(
      removeBackgroundFal({ in: IN_PATH, out: OUT_PATH, engine }, deps)
    );

    expect(error.message).toContain(`maximum is ${MAX_FAL_RESULT_BYTES} bytes`);
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.writeJson).not.toHaveBeenCalled();
  });

  it.each(ENGINES)('rejects a non-PNG $engine download without writing', async ({ engine }) => {
    const deps = createDeps({
      fetchBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
    });

    const error = await captureError(
      removeBackgroundFal({ in: IN_PATH, out: OUT_PATH, engine }, deps)
    );

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

  it('discloses the bria estimate before and after the paid call', async () => {
    const deps = createDeps();

    await removeBackgroundFal({ in: IN_PATH, out: OUT_PATH }, deps);

    const lines = vi.mocked(deps.log).mock.calls.map((call) => String(call[0]));
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe(
      'Cost (estimate): $0.01800 per generations (list price as of 2026-10-25; live lookup unavailable) × 1 generation ≈ $0.01800'
    );
    expect(lines[1]).toBe(
      'fal returns no billed cost; check the fal dashboard for the actual bill.'
    );
    expect(lines[2]).toBe(
      'Estimated cost: $0.01800 per generations (list price as of 2026-10-25; live lookup unavailable) × 1 generation ≈ $0.01800'
    );
    expect(lines[3]).toBe(
      'fal returns no billed cost; check the fal dashboard for the actual bill.'
    );
    expect(deps.lookupPrices).toHaveBeenCalledWith([BRIA_MODEL]);

    const logOrder = vi.mocked(deps.log).mock.invocationCallOrder[0];
    const subscribeOrder = vi.mocked(deps.falSubscribe).mock.invocationCallOrder[0];
    const writeJsonOrder = vi.mocked(deps.writeJson).mock.invocationCallOrder[0];
    expect(logOrder).toBeLessThan(subscribeOrder as number);
    expect(vi.mocked(deps.log).mock.invocationCallOrder[2]).toBeGreaterThan(
      writeJsonOrder as number
    );
  });

  it('shows the birefnet rate only and never invents a total', async () => {
    const deps = createDeps();

    await removeBackgroundFal({ in: IN_PATH, out: OUT_PATH, engine: 'birefnet' }, deps);

    const output = vi
      .mocked(deps.log)
      .mock.calls.map((call) => String(call[0]))
      .join('\n');
    expect(output).toContain(
      'Cost (rate only): $0.0005750 per compute seconds (list price as of 2026-10-25; live lookup unavailable). total depends on runtime; not estimated.'
    );
    expect(output).toContain('Estimated cost (rate only):');
    expect(output).toContain('total depends on runtime; not estimated.');
    expect(output).not.toContain('≈');
  });

  it('falls back to the list price when the lookup throws', async () => {
    const deps = createDeps({
      lookupPrices: vi.fn().mockRejectedValue(new Error('pricing offline')),
    });

    await removeBackgroundFal({ in: IN_PATH, out: OUT_PATH }, deps);

    const output = vi
      .mocked(deps.log)
      .mock.calls.map((call) => String(call[0]))
      .join('\n');
    expect(output).toContain('list price as of 2026-10-25; live lookup unavailable');
    expect(output).toContain('$0.01800');
    expect(deps.writeFile).toHaveBeenCalled();
  });

  it('labels a live bria rate as the account rate', async () => {
    const live: FalUnitPrice = {
      endpointId: BRIA_MODEL,
      unitPrice: 0.02,
      unit: 'generations',
      rateSource: 'live',
    };
    const deps = createDeps({
      lookupPrices: vi.fn(async () => new Map([[BRIA_MODEL, live]])),
    });

    await removeBackgroundFal({ in: IN_PATH, out: OUT_PATH }, deps);

    const output = vi
      .mocked(deps.log)
      .mock.calls.map((call) => String(call[0]))
      .join('\n');
    expect(output).toContain('$0.02000 per generations (live rate for this account)');
    expect(output).toContain('≈ $0.02000');
  });
});

describe('validateBackgroundResult', () => {
  it('narrows a background result to the image url for either model', () => {
    for (const model of [BRIA_MODEL, BIFNET_MODEL]) {
      expect(validateBackgroundResult(result(), model)).toEqual({
        requestId: 'req-1',
        data: { image: { url: IMAGE_URL } },
      });
    }
  });
});
