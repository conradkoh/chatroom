/**
 * Generate Image Unit Tests
 *
 * Exercises the pure generation logic with injected deps only. No network,
 * no filesystem, no fal SDK import.
 */

import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { FalImageResult, GenerateImageDeps, PathStatus } from './deps.js';
import {
  formatGenerateImagePlan,
  GenerateImageError,
  generateImage,
  parseInputJson,
  planGenerateImage,
} from './image.js';
import type { GenerateImagePlatform } from './image.js';
import { FLUX_2_FLASH_EDIT_MODEL, FLUX_2_FLASH_MODEL } from './model-capabilities.js';
import {
  listUnitPrices,
  lookupFalUnitPrices,
  type FalUnitPrice,
} from '../image-shared/fal-pricing.js';

const FAL_API_KEY = 'fal-api-key-should-never-be-written';
const OUT_PATH = '/tmp/generated/hero.png';
const IMAGE_URL = 'https://fal.test/generated/hero.png';
const UPLOADED_IMAGE_URL = 'https://fal.test/uploaded/hero.png';
const INPUT_IMAGE = '/tmp/inputs/hero.png';
const INPUT_IMAGE_URL = 'https://example.test/source/hero.png';
const IMAGE_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Minimal PNG header: signature, IHDR length/type, width, and height. */
function pngBytes(width: number, height: number): Uint8Array {
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

function falResult(overrides: { seed?: number } = {}): FalImageResult {
  return {
    data: {
      images: [
        {
          url: IMAGE_URL,
          content_type: 'image/png',
          file_name: 'hero.png',
          width: 1024,
          height: 768,
        },
      ],
      ...(overrides.seed !== undefined ? { seed: overrides.seed } : {}),
    },
    requestId: 'req-123',
  };
}

function createDeps(overrides: Partial<GenerateImageDeps> = {}): GenerateImageDeps {
  return {
    env: { FAL_API_KEY },
    falSubscribe: vi.fn().mockResolvedValue(falResult()),
    uploadFile: vi.fn().mockResolvedValue(UPLOADED_IMAGE_URL),
    fetchBytes: vi.fn().mockResolvedValue(IMAGE_BYTES),
    readFileBytes: vi.fn().mockResolvedValue(IMAGE_BYTES),
    lookupPrices: vi.fn(async (ids: readonly string[]) => listUnitPrices(ids)),
    writeFile: vi.fn().mockResolvedValue(undefined),
    writeJson: vi.fn().mockResolvedValue(undefined),
    pathStatus: vi.fn().mockResolvedValue('missing'),
    ensureParentDir: vi.fn().mockResolvedValue(undefined),
    now: () => new Date('2026-01-02T03:04:05.000Z'),
    sdkVersion: '1.10.1',
    warn: vi.fn(),
    log: vi.fn(),
    ...overrides,
  };
}

/** pathStatus fake backed by an explicit map; anything unlisted is missing. */
function pathStatusFor(entries: Record<string, PathStatus>): GenerateImageDeps['pathStatus'] {
  return vi.fn(async (path: string) => entries[path] ?? 'missing');
}

/** Await a promise expected to reject and return the error. */
async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected the call to reject');
}

describe('generateImage', () => {
  it('rejects when FAL_API_KEY is missing and makes no fal call', async () => {
    const deps = createDeps({ env: {} });

    const error = await captureError(
      generateImage({ model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH }, deps)
    );

    expect(error.message).toContain('FAL_API_KEY is not set');
    expect(error.message).toContain('FAL_KEY_ID/FAL_KEY_SECRET are not supported');
    expect(deps.falSubscribe).not.toHaveBeenCalled();
    expect(deps.fetchBytes).not.toHaveBeenCalled();
  });

  it('does not fall back to the old FAL_KEY name', async () => {
    const deps = createDeps({ env: { FAL_KEY: 'old-name-only' } });

    await expect(
      generateImage({ model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH }, deps)
    ).rejects.toThrow('FAL_API_KEY is not set');
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('rejects an empty prompt', async () => {
    const deps = createDeps();

    await expect(
      generateImage({ model: FLUX_2_FLASH_MODEL, prompt: '   ', out: OUT_PATH }, deps)
    ).rejects.toThrow('--prompt must not be empty');
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('rejects an empty out path', async () => {
    const deps = createDeps();

    await expect(
      generateImage({ model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: '  ' }, deps)
    ).rejects.toThrow('--out must not be empty');
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('rejects an unsupported platform before calling fal', async () => {
    const deps = createDeps();

    await expect(
      generateImage(
        {
          model: FLUX_2_FLASH_MODEL,
          prompt: 'a hero',
          out: OUT_PATH,
          platform: 'replicate' as GenerateImagePlatform,
        },
        deps
      )
    ).rejects.toThrow('unsupported platform: replicate');
    expect(deps.falSubscribe).not.toHaveBeenCalled();
    expect(deps.fetchBytes).not.toHaveBeenCalled();
  });

  it('defaults the platform to fal', async () => {
    const deps = createDeps();

    await generateImage({ model: FLUX_2_FLASH_MODEL, prompt: 'a castle', out: OUT_PATH }, deps);

    const manifest = (deps.writeJson as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(manifest.platform).toBe('fal');
  });

  it('records an explicitly selected fal platform', async () => {
    const deps = createDeps();

    await generateImage(
      { model: FLUX_2_FLASH_MODEL, prompt: 'a castle', out: OUT_PATH, platform: 'fal' },
      deps
    );

    const manifest = (deps.writeJson as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(manifest.platform).toBe('fal');
  });

  it('rejects when fal returns no image', async () => {
    const deps = createDeps({
      falSubscribe: vi.fn().mockResolvedValue({
        data: { images: [] },
        requestId: 'req-empty',
      }),
    });

    await expect(
      generateImage({ model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH }, deps)
    ).rejects.toThrow('fal returned no image for model fal-ai/flux-2/flash');
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('writes the image bytes and a manifest that never contains FAL_API_KEY', async () => {
    const deps = createDeps();

    const result = await generateImage(
      {
        prompt: 'a knight in a forest',
        out: OUT_PATH,
        model: FLUX_2_FLASH_MODEL,
        outputFormat: 'png',
        seed: 42,
      },
      deps
    );

    const expectedSha = createHash('sha256').update(IMAGE_BYTES).digest('hex');
    expect(result).toEqual({
      outPath: OUT_PATH,
      manifestPath: `${OUT_PATH}.json`,
      sha256: expectedSha,
      costLines: [
        'Estimated cost: $0.005000 per megapixel (list price as of 2026-10-25; live lookup unavailable) × 0.79 MP (actual 1024x768) ≈ $0.003932',
        'fal returns no billed cost; check the fal dashboard for the actual bill.',
      ],
    });

    expect(deps.falSubscribe).toHaveBeenCalledWith(FLUX_2_FLASH_MODEL, {
      prompt: 'a knight in a forest',
      output_format: 'png',
      seed: 42,
    });
    expect(deps.writeFile).toHaveBeenCalledWith(OUT_PATH, IMAGE_BYTES);

    const manifest = (deps.writeJson as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(manifest.tool).toBe('chatroom generate-image');
    expect(manifest.sdk).toBe('@fal-ai/client@1.10.1');
    expect(manifest.model).toBe(FLUX_2_FLASH_MODEL);
    expect(manifest.input).toEqual({
      prompt: 'a knight in a forest',
      output_format: 'png',
      seed: 42,
    });
    expect(manifest.requestId).toBe('req-123');
    expect(manifest.seed).toBe(42);
    expect(manifest.output).toEqual({
      path: OUT_PATH,
      sha256: expectedSha,
      contentType: 'image/png',
      bytes: IMAGE_BYTES.byteLength,
    });
    expect(manifest.generatedAt).toBe('2026-01-02T03:04:05.000Z');
    expect(manifest.licensing).toBe('unverified');
    expect(JSON.stringify(manifest).includes(FAL_API_KEY)).toBe(false);

    const writeJsonCalls = (deps.writeJson as ReturnType<typeof vi.fn>).mock.calls;
    expect(writeJsonCalls[0]?.[0]).toBe(`${OUT_PATH}.json`);
    expect(writeJsonCalls[0]?.[1]).toEqual(manifest);
  });

  it('merges --input into the fal body and the manifest', async () => {
    const deps = createDeps();
    const input = {
      image_size: { width: 1024, height: 768 },
      enable_prompt_expansion: false,
      negative_prompt: 'blurry',
    };

    await generateImage(
      {
        prompt: 'a layout',
        out: OUT_PATH,
        model: 'fal-ai/flux-2/flash',
        input,
        outputFormat: 'png',
      },
      deps
    );

    const expected = { prompt: 'a layout', ...input, output_format: 'png' };
    expect(deps.falSubscribe).toHaveBeenCalledWith('fal-ai/flux-2/flash', expected);
    expect(deps.warn).toHaveBeenCalledWith(expect.stringContaining('negative_prompt'));
    const manifest = (deps.writeJson as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(manifest.input).toEqual(expected);
  });

  it('does not let --input override the prompt or dedicated flags', async () => {
    const deps = createDeps();

    await expect(
      generateImage(
        { model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH, input: { seed: 1 } },
        deps
      )
    ).rejects.toThrow('use --seed instead');
    await expect(
      generateImage(
        { model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH, input: { prompt: 'other' } },
        deps
      )
    ).rejects.toThrow('use --prompt instead');
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it.each([
    ['seed', '--seed'],
    ['output_format', '--output-format'],
    ['aspect_ratio', '--aspect-ratio'],
    ['image_urls', '--input-image'],
  ])('refuses the reserved input key %s and names %s', async (key, flag) => {
    const deps = createDeps({ pathStatus: pathStatusFor({ [INPUT_IMAGE]: 'file' }) });

    const error = await captureError(
      generateImage(
        {
          model: FLUX_2_FLASH_EDIT_MODEL,
          prompt: 'a hero',
          out: OUT_PATH,
          inputImage: INPUT_IMAGE,
          input: { [key]: 'x' },
        },
        deps
      )
    );

    expect(error.message).toContain(`"${key}"`);
    expect(error.message).toContain(flag);
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('rejects reserved --input keys before uploading or creating the output directory', async () => {
    const deps = createDeps({ pathStatus: pathStatusFor({ [INPUT_IMAGE]: 'file' }) });

    const error = await captureError(
      generateImage(
        {
          model: FLUX_2_FLASH_EDIT_MODEL,
          prompt: 'a hero',
          out: OUT_PATH,
          inputImage: INPUT_IMAGE,
          input: { image_urls: ['https://example.test/other.png'] },
        },
        deps
      )
    );

    expect(error.message).toContain('"image_urls"');
    expect(error.message).toContain('use --input-image instead');
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.ensureParentDir).not.toHaveBeenCalled();
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('refuses sync_mode in --input before calling fal', async () => {
    const deps = createDeps();

    const error = await captureError(
      generateImage(
        { model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH, input: { sync_mode: true } },
        deps
      )
    );

    expect(error.message).toContain('sync_mode');
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('allows num_images 1 but refuses extra images in --input', async () => {
    const deps = createDeps();

    await generateImage(
      { model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH, input: { num_images: 1 } },
      deps
    );
    expect(deps.falSubscribe).toHaveBeenCalledTimes(1);

    const refused = createDeps();
    const error = await captureError(
      generateImage(
        { model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH, input: { num_images: 2 } },
        refused
      )
    );
    expect(error.message).toContain('num_images must be 1');
    expect(refused.falSubscribe).not.toHaveBeenCalled();
  });

  it('warns when fal returns more than one image and saves the first', async () => {
    const deps = createDeps({
      falSubscribe: vi.fn().mockResolvedValue({
        data: {
          images: [
            { url: 'https://fal.test/first.png', content_type: 'image/png' },
            { url: 'https://fal.test/second.png', content_type: 'image/png' },
          ],
        },
        requestId: 'req-many',
      }),
    });

    await generateImage({ model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH }, deps);

    expect(deps.warn).toHaveBeenCalledWith('⚠️ fal returned 2 images; only the first is saved.');
    expect(deps.fetchBytes).toHaveBeenCalledWith('https://fal.test/first.png');
  });

  it('parses inline input JSON and rejects invalid shapes', () => {
    expect(parseInputJson('{"image_size":{"width":512,"height":512}}')).toEqual({
      image_size: { width: 512, height: 512 },
    });
    expect(() => parseInputJson('not json')).toThrow('valid JSON');
    expect(() => parseInputJson('[]')).toThrow('JSON object');
    expect(() => parseInputJson('"text"')).toThrow('JSON object');
    expect(() => parseInputJson('null')).toThrow('JSON object');
  });

  it('sends only the prompt when no optional fields are given', async () => {
    const deps = createDeps();

    // fal-ai/flux/dev has no aspect_ratio, so CLI-side defaults would break it.
    await generateImage({ prompt: 'a castle', out: OUT_PATH, model: 'fal-ai/flux/dev' }, deps);

    expect(deps.falSubscribe).toHaveBeenCalledWith('fal-ai/flux/dev', {
      prompt: 'a castle',
    });
    const manifest = (deps.writeJson as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(manifest.input).toEqual({ prompt: 'a castle' });
    expect(manifest.input).not.toHaveProperty('aspect_ratio');
    expect(manifest.input).not.toHaveProperty('output_format');
    expect(manifest.input).not.toHaveProperty('seed');
    expect(manifest.seed).toBeNull();
  });

  it('refuses to overwrite an existing output without --force', async () => {
    const deps = createDeps({ pathStatus: pathStatusFor({ [OUT_PATH]: 'file' }) });

    await expect(
      generateImage({ model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH }, deps)
    ).rejects.toThrow(`--out already exists: ${OUT_PATH}. Pass --force to overwrite.`);
    expect(deps.falSubscribe).not.toHaveBeenCalled();
    expect(deps.ensureParentDir).not.toHaveBeenCalled();
  });

  it('refuses to overwrite an existing manifest without --force', async () => {
    const deps = createDeps({
      pathStatus: pathStatusFor({ [`${OUT_PATH}.json`]: 'file' }),
    });

    await expect(
      generateImage({ model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH }, deps)
    ).rejects.toThrow('Manifest already exists');
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('overwrites an existing output when --force is passed', async () => {
    const deps = createDeps({
      pathStatus: pathStatusFor({ [OUT_PATH]: 'file', [`${OUT_PATH}.json`]: 'file' }),
    });

    await generateImage(
      { model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH, force: true },
      deps
    );

    expect(deps.falSubscribe).toHaveBeenCalledTimes(1);
    expect(deps.writeFile).toHaveBeenCalledWith(OUT_PATH, IMAGE_BYTES);
  });

  it('refuses a directory output before generation', async () => {
    const deps = createDeps({ pathStatus: pathStatusFor({ [OUT_PATH]: 'directory' }) });

    await expect(
      generateImage({ model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH }, deps)
    ).rejects.toThrow('is a directory');
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('rejects an output format that disagrees with the file extension', async () => {
    const deps = createDeps();

    await expect(
      generateImage(
        { model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH, outputFormat: 'webp' },
        deps
      )
    ).rejects.toThrow('--output-format webp does not match the --out extension .png');
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it.each(['.jpg', '.jpeg', '.JPG'])(
    'refuses the unsupported JPEG extension %s before generation',
    async (extension) => {
      const deps = createDeps();

      await expect(
        generateImage(
          { model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: `/tmp/generated/hero${extension}` },
          deps
        )
      ).rejects.toThrow(
        `Unsupported output extension ${extension.toLowerCase()}. Use .png or .webp (transparency-capable).`
      );
      expect(deps.falSubscribe).not.toHaveBeenCalled();
    }
  );

  it('accepts png and webp outputs', async () => {
    for (const [out, format] of [
      ['/tmp/generated/hero.png', 'png'],
      ['/tmp/generated/hero.webp', 'webp'],
    ] as const) {
      const deps = createDeps();

      await generateImage(
        { model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out, outputFormat: format },
        deps
      );

      expect(deps.falSubscribe).toHaveBeenCalledTimes(1);
    }
  });

  it('records the resolved output path in the manifest', async () => {
    const deps = createDeps();
    const relativeOut = 'relative/hero.png';

    await generateImage({ model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: relativeOut }, deps);

    const manifest = (deps.writeJson as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(manifest.output).toMatchObject({ path: resolve(relativeOut) });
  });

  it('creates the parent directory before calling fal', async () => {
    const deps = createDeps();

    await generateImage({ model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH }, deps);

    const ensureOrder = (deps.ensureParentDir as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    const subscribeOrder = (deps.falSubscribe as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    expect(deps.ensureParentDir).toHaveBeenCalledWith(OUT_PATH);
    expect(ensureOrder).toBeLessThan(subscribeOrder as number);
  });

  it('keeps the paid result recoverable when the download fails', async () => {
    const deps = createDeps({
      fetchBytes: vi.fn().mockRejectedValue(new Error('network down')),
    });

    const error = await captureError(
      generateImage({ model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH }, deps)
    );

    expect(error.message).toContain('req-123');
    expect(error.message).toContain(IMAGE_URL);
    expect(error.message).toContain('network down');
    expect(error.message.includes(FAL_API_KEY)).toBe(false);
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('keeps the paid result recoverable when the image write fails', async () => {
    const deps = createDeps({
      writeFile: vi.fn().mockRejectedValue(new Error('disk full')),
    });

    const error = await captureError(
      generateImage({ model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH }, deps)
    );

    expect(error.message).toContain('req-123');
    expect(error.message).toContain(IMAGE_URL);
    expect(error.message).toContain('disk full');
    expect(error.message.includes(FAL_API_KEY)).toBe(false);
  });

  it('prefers the seed echoed back by fal over the requested seed', async () => {
    const deps = createDeps({
      falSubscribe: vi.fn().mockResolvedValue(falResult({ seed: 777 })),
    });

    await generateImage(
      { model: FLUX_2_FLASH_MODEL, prompt: 'a castle', out: OUT_PATH, seed: 42 },
      deps
    );

    const manifest = (deps.writeJson as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(manifest.seed).toBe(777);
  });

  it('edits a local image with the edit model', async () => {
    const deps = createDeps({ pathStatus: pathStatusFor({ [INPUT_IMAGE]: 'file' }) });

    await generateImage(
      {
        model: FLUX_2_FLASH_EDIT_MODEL,
        prompt: 'make the sky stormy',
        out: OUT_PATH,
        inputImage: INPUT_IMAGE,
      },
      deps
    );

    expect(deps.uploadFile).toHaveBeenCalledTimes(1);
    expect(deps.uploadFile).toHaveBeenCalledWith(INPUT_IMAGE, 'image/png');
    expect(deps.falSubscribe).toHaveBeenCalledWith(FLUX_2_FLASH_EDIT_MODEL, {
      prompt: 'make the sky stormy',
      image_urls: [UPLOADED_IMAGE_URL],
    });

    const manifest = (deps.writeJson as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(manifest.model).toBe(FLUX_2_FLASH_EDIT_MODEL);
    expect(manifest.input).toEqual({
      prompt: 'make the sky stormy',
      image_urls: [UPLOADED_IMAGE_URL],
    });
    expect(manifest.inputImage).toEqual({ source: INPUT_IMAGE, url: UPLOADED_IMAGE_URL });
  });

  it('passes an http(s) input URL through without uploading', async () => {
    const deps = createDeps();

    await generateImage(
      {
        model: FLUX_2_FLASH_EDIT_MODEL,
        prompt: 'make it night',
        out: OUT_PATH,
        inputImage: INPUT_IMAGE_URL,
      },
      deps
    );

    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.falSubscribe).toHaveBeenCalledWith(FLUX_2_FLASH_EDIT_MODEL, {
      prompt: 'make it night',
      image_urls: [INPUT_IMAGE_URL],
    });

    const manifest = (deps.writeJson as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(manifest.inputImage).toEqual({ source: INPUT_IMAGE_URL, url: INPUT_IMAGE_URL });
  });

  it('uses an explicit --model even with --input-image', async () => {
    const explicitModel = 'fal-ai/some-other/edit';
    const deps = createDeps({ pathStatus: pathStatusFor({ [INPUT_IMAGE]: 'file' }) });

    await generateImage(
      { prompt: 'restyle', out: OUT_PATH, inputImage: INPUT_IMAGE, model: explicitModel },
      deps
    );

    expect(deps.falSubscribe).toHaveBeenCalledWith(explicitModel, {
      prompt: 'restyle',
      image_urls: [UPLOADED_IMAGE_URL],
    });
  });

  it('rejects an empty --model before any file or fal work', async () => {
    const deps = createDeps();

    const error = await captureError(
      generateImage({ model: '   ', prompt: 'a hero', out: OUT_PATH }, deps)
    );

    expect(error.message).toBe('--model must not be empty.');
    expect(deps.pathStatus).not.toHaveBeenCalled();
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('rejects the edit model without --input-image before any file or fal work', async () => {
    const deps = createDeps();

    const error = await captureError(
      generateImage({ model: FLUX_2_FLASH_EDIT_MODEL, prompt: 'a hero', out: OUT_PATH }, deps)
    );

    expect(error.message).toBe(
      `${FLUX_2_FLASH_EDIT_MODEL} edits an image; pass --input-image <path-or-url>.`
    );
    expect(deps.pathStatus).not.toHaveBeenCalled();
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('rejects the text model with --input-image before any file or fal work', async () => {
    const deps = createDeps();

    const error = await captureError(
      generateImage(
        { model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH, inputImage: INPUT_IMAGE },
        deps
      )
    );

    expect(error.message).toBe(
      `${FLUX_2_FLASH_MODEL} does not take an input image; use --model ${FLUX_2_FLASH_EDIT_MODEL} with --input-image.`
    );
    expect(deps.pathStatus).not.toHaveBeenCalled();
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it.each([
    { model: FLUX_2_FLASH_MODEL, inputImage: undefined },
    { model: FLUX_2_FLASH_EDIT_MODEL, inputImage: INPUT_IMAGE },
  ])(
    'rejects --aspect-ratio for $model before any file or fal work',
    async ({ model, inputImage }) => {
      const deps = createDeps();

      const error = await captureError(
        generateImage(
          { model, prompt: 'a hero', out: OUT_PATH, inputImage, aspectRatio: '1:1' },
          deps
        )
      );

      expect(error.message).toContain(`--aspect-ratio is not supported by ${model}.`);
      expect(deps.pathStatus).not.toHaveBeenCalled();
      expect(deps.uploadFile).not.toHaveBeenCalled();
      expect(deps.falSubscribe).not.toHaveBeenCalled();
    }
  );

  it('passes --aspect-ratio through for an unknown model', async () => {
    const deps = createDeps();

    await generateImage(
      { model: 'acme/custom', prompt: 'a hero', out: OUT_PATH, aspectRatio: '1:1' },
      deps
    );

    expect(deps.falSubscribe).toHaveBeenCalledWith('acme/custom', {
      prompt: 'a hero',
      aspect_ratio: '1:1',
    });
  });

  it.each(['missing', 'directory'] as const)(
    'rejects a local input image that is %s before uploading',
    async (status) => {
      const deps = createDeps({ pathStatus: pathStatusFor({ [INPUT_IMAGE]: status }) });

      const error = await captureError(
        generateImage(
          {
            model: FLUX_2_FLASH_EDIT_MODEL,
            prompt: 'a hero',
            out: OUT_PATH,
            inputImage: INPUT_IMAGE,
          },
          deps
        )
      );

      expect(error.message).toContain(`--input-image is not a file: ${INPUT_IMAGE}`);
      expect(deps.uploadFile).not.toHaveBeenCalled();
      expect(deps.falSubscribe).not.toHaveBeenCalled();
    }
  );

  it('rejects an unsupported input image extension before uploading', async () => {
    const unsupported = '/tmp/inputs/hero.bmp';
    const deps = createDeps({ pathStatus: pathStatusFor({ [unsupported]: 'file' }) });

    const error = await captureError(
      generateImage(
        {
          model: FLUX_2_FLASH_EDIT_MODEL,
          prompt: 'a hero',
          out: OUT_PATH,
          inputImage: unsupported,
        },
        deps
      )
    );

    expect(error.message).toContain('Unsupported --input-image extension .bmp');
    expect(error.message).toContain('.png');
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('checks an existing output before uploading the input image', async () => {
    const deps = createDeps({
      pathStatus: pathStatusFor({ [INPUT_IMAGE]: 'file', [OUT_PATH]: 'file' }),
    });

    await expect(
      generateImage(
        {
          model: FLUX_2_FLASH_EDIT_MODEL,
          prompt: 'a hero',
          out: OUT_PATH,
          inputImage: INPUT_IMAGE,
        },
        deps
      )
    ).rejects.toThrow(`--out already exists: ${OUT_PATH}`);

    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.ensureParentDir).not.toHaveBeenCalled();
  });

  it('checks the output format before uploading the input image', async () => {
    const deps = createDeps({ pathStatus: pathStatusFor({ [INPUT_IMAGE]: 'file' }) });

    await expect(
      generateImage(
        {
          model: FLUX_2_FLASH_EDIT_MODEL,
          prompt: 'a hero',
          out: OUT_PATH,
          inputImage: INPUT_IMAGE,
          outputFormat: 'webp',
        },
        deps
      )
    ).rejects.toThrow('--output-format webp does not match the --out extension .png');

    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.ensureParentDir).not.toHaveBeenCalled();
  });

  it('checks the output extension before uploading the input image', async () => {
    const deps = createDeps({ pathStatus: pathStatusFor({ [INPUT_IMAGE]: 'file' }) });

    await expect(
      generateImage(
        {
          model: FLUX_2_FLASH_EDIT_MODEL,
          prompt: 'a hero',
          out: '/tmp/generated/hero.jpg',
          inputImage: INPUT_IMAGE,
        },
        deps
      )
    ).rejects.toThrow('Unsupported output extension .jpg');

    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.ensureParentDir).not.toHaveBeenCalled();
  });

  it('validates the input image before creating the output directory', async () => {
    const deps = createDeps({ pathStatus: pathStatusFor({ [INPUT_IMAGE]: 'missing' }) });

    await expect(
      generateImage(
        {
          model: FLUX_2_FLASH_EDIT_MODEL,
          prompt: 'a hero',
          out: OUT_PATH,
          inputImage: INPUT_IMAGE,
        },
        deps
      )
    ).rejects.toThrow(`--input-image is not a file: ${INPUT_IMAGE}`);

    expect(deps.ensureParentDir).not.toHaveBeenCalled();
    expect(deps.uploadFile).not.toHaveBeenCalled();
  });

  it('plans without FAL_API_KEY and makes no side effects', async () => {
    const deps = createDeps({ env: {} });

    const plan = await planGenerateImage(
      { model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH },
      deps
    );

    expect(plan).toMatchObject({
      platform: 'fal',
      model: FLUX_2_FLASH_MODEL,
      outPath: OUT_PATH,
      manifestPath: `${OUT_PATH}.json`,
      input: { prompt: 'a hero' },
    });
    expect(deps.ensureParentDir).not.toHaveBeenCalled();
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.falSubscribe).not.toHaveBeenCalled();
    expect(deps.fetchBytes).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.writeJson).not.toHaveBeenCalled();
  });

  it('refuses an existing output while planning', async () => {
    const deps = createDeps({ pathStatus: pathStatusFor({ [OUT_PATH]: 'file' }) });

    await expect(
      planGenerateImage({ model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH }, deps)
    ).rejects.toThrow(`--out already exists: ${OUT_PATH}`);
    expect(deps.ensureParentDir).not.toHaveBeenCalled();
  });

  it('points a dry run at --force when the output already exists', async () => {
    const deps = createDeps({ pathStatus: pathStatusFor({ [OUT_PATH]: 'file' }) });

    await expect(
      planGenerateImage(
        { model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH, dryRun: true },
        deps
      )
    ).rejects.toThrow(
      /--out already exists.*Add --force to print the plan.*dry run writes nothing/
    );

    expect(deps.falSubscribe).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('plans an existing output in a dry run when --force is passed', async () => {
    const deps = createDeps({ pathStatus: pathStatusFor({ [OUT_PATH]: 'file' }) });

    const plan = await planGenerateImage(
      { model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH, dryRun: true, force: true },
      deps
    );

    expect(plan.outPath).toBe(OUT_PATH);
    expect(deps.falSubscribe).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('refuses an unsupported output extension while planning', async () => {
    const deps = createDeps();

    await expect(
      planGenerateImage(
        { model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: '/tmp/generated/hero.jpg' },
        deps
      )
    ).rejects.toThrow('Unsupported output extension .jpg');
  });

  it('formats a plan with the exact request and constraint disclosures', async () => {
    const deps = createDeps();
    const plan = await planGenerateImage(
      {
        model: FLUX_2_FLASH_MODEL,
        prompt: 'a hero',
        out: OUT_PATH,
        input: { negative_prompt: 'blurry' },
      },
      deps
    );

    const text = formatGenerateImagePlan(plan);

    expect(text).toContain(`Would generate ${OUT_PATH}`);
    expect(text).toContain(`Model ${FLUX_2_FLASH_MODEL} (FLUX 2 Flash, text-to-image)`);
    expect(text).toContain(JSON.stringify(plan.input, null, 2));
    expect(text).toContain('- unsupported: negative_prompt (--input)');
    expect(text).toContain('No upload or fal generation call was made.');
  });

  it('shows a placeholder URL for a local input image without uploading', async () => {
    const deps = createDeps({ pathStatus: pathStatusFor({ [INPUT_IMAGE]: 'file' }) });

    const plan = await planGenerateImage(
      {
        model: FLUX_2_FLASH_EDIT_MODEL,
        prompt: 'a hero',
        out: OUT_PATH,
        inputImage: INPUT_IMAGE,
      },
      deps
    );

    const text = formatGenerateImagePlan(plan);

    expect(text).toContain(
      `Input image ${INPUT_IMAGE} (would be uploaded to fal storage, 1-day lifetime)`
    );
    expect(text).toContain(`<fal storage URL for ${INPUT_IMAGE}>`);
    expect(deps.uploadFile).not.toHaveBeenCalled();
  });

  it('formats the planned cost estimate for a text-to-image dry run', async () => {
    const deps = createDeps();

    const plan = await planGenerateImage(
      { model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH },
      deps
    );
    const text = formatGenerateImagePlan(plan);

    expect(deps.lookupPrices).toHaveBeenCalledWith([FLUX_2_FLASH_MODEL]);
    expect(text).toContain(
      'Cost (estimate): $0.005000 per megapixel (list price as of 2026-10-25; live lookup unavailable)'
    );
    expect(text).toContain('× 0.79 MP (planned output) ≈ $0.003932');
    expect(text).toContain(
      'fal returns no billed cost; this is computed from the planned image size.'
    );
    expect(text).toContain('No upload or fal generation call was made.');
  });

  it('estimates from a custom image_size instead of the default', async () => {
    const deps = createDeps();

    const plan = await planGenerateImage(
      {
        model: FLUX_2_FLASH_MODEL,
        prompt: 'a hero',
        out: OUT_PATH,
        input: { image_size: { width: 1024, height: 1024 } },
      },
      deps
    );

    const text = formatGenerateImagePlan(plan);
    expect(text).toContain('× 1.05 MP (planned output) ≈ $0.005243');
  });

  it('prints the rate only for an unknown image_size preset', async () => {
    const deps = createDeps();

    const plan = await planGenerateImage(
      {
        model: FLUX_2_FLASH_MODEL,
        prompt: 'a hero',
        out: OUT_PATH,
        input: { image_size: 'huge' },
      },
      deps
    );

    const text = formatGenerateImagePlan(plan);
    expect(text).toContain(
      'Cost (rate only): $0.005000 per megapixel (list price as of 2026-10-25; live lookup unavailable).'
    );
    expect(text).toContain(
      'The image_size "huge" is not a known preset; output size not estimated.'
    );
    expect(text).toContain(
      'fal returns no billed cost; check the fal dashboard for the actual bill.'
    );
    expect(text).not.toContain('≈');
  });

  it('prints unknown cost for a model with no rate data', async () => {
    const deps = createDeps();

    const plan = await planGenerateImage(
      { model: 'acme/custom', prompt: 'a hero', out: OUT_PATH },
      deps
    );

    const text = formatGenerateImagePlan(plan);
    expect(text).toContain('Cost: unknown for acme/custom; no rate data.');
    expect(text).not.toContain('fal returns no billed cost');
  });

  it('counts the edit input as 1 MP regardless of a large local PNG', async () => {
    const deps = createDeps({
      pathStatus: pathStatusFor({ [INPUT_IMAGE]: 'file' }),
      readFileBytes: vi.fn().mockResolvedValue(pngBytes(2048, 2048)),
    });

    const plan = await planGenerateImage(
      {
        model: FLUX_2_FLASH_EDIT_MODEL,
        prompt: 'make it stormy',
        out: OUT_PATH,
        inputImage: INPUT_IMAGE,
      },
      deps
    );

    const text = formatGenerateImagePlan(plan);
    expect(text).toContain('Formula (unverified): (1 MP input + output MP) × rate.');
    expect(text).toContain(
      'Input is 2048x2048 (4.19 MP); fal resizes it to 1 MP, so the estimate counts 1 MP of input.'
    );
    expect(text).toContain('× 2.05 MP (1.00 MP input + 1.05 MP output) ≈ $0.01024');
    expect(text).toContain(
      'Input image /tmp/inputs/hero.png (would be uploaded to fal storage, 1-day lifetime)'
    );
  });

  it('counts a 512x512 edit input as 1 MP, not 0.26 MP', async () => {
    const deps = createDeps({
      pathStatus: pathStatusFor({ [INPUT_IMAGE]: 'file' }),
      readFileBytes: vi.fn().mockResolvedValue(pngBytes(512, 512)),
    });

    const plan = await planGenerateImage(
      {
        model: FLUX_2_FLASH_EDIT_MODEL,
        prompt: 'make it stormy',
        out: OUT_PATH,
        inputImage: INPUT_IMAGE,
      },
      deps
    );

    const text = formatGenerateImagePlan(plan);
    expect(text).toContain(
      'Input is 512x512 (0.26 MP); fal resizes it to 1 MP, so the estimate counts 1 MP of input.'
    );
    expect(text).toContain('× 2.05 MP (1.00 MP input + 1.05 MP output)');
    expect(text).not.toContain('0.26 MP input');
  });

  it('labels a live rate as the account rate', async () => {
    const live: FalUnitPrice = {
      endpointId: FLUX_2_FLASH_MODEL,
      unitPrice: 0.004,
      unit: 'megapixels',
      rateSource: 'live',
    };
    const deps = createDeps({
      lookupPrices: vi.fn(async () => new Map([[FLUX_2_FLASH_MODEL, live]])),
    });

    const plan = await planGenerateImage(
      { model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH },
      deps
    );

    const text = formatGenerateImagePlan(plan);
    expect(text).toContain('$0.004000 per megapixel (live rate for this account)');
    expect(text).toContain('≈ $0.003146');
  });

  it('does not touch the network while planning without FAL_API_KEY', async () => {
    const getJson = vi.fn(async () => {
      throw new Error('network must not be called');
    });
    const deps = createDeps({
      env: {},
      lookupPrices: (ids) => lookupFalUnitPrices(ids, { env: {}, getJson }),
    });

    const plan = await planGenerateImage(
      { model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH },
      deps
    );

    expect(getJson).not.toHaveBeenCalled();
    expect(formatGenerateImagePlan(plan)).toContain('list price as of 2026-10-25');
  });

  it('prints the pre-call estimate before the paid call and returns the actual-size estimate', async () => {
    const deps = createDeps({
      falSubscribe: vi.fn().mockResolvedValue({
        data: {
          images: [{ url: IMAGE_URL, content_type: 'image/png', width: 512, height: 512 }],
        },
        requestId: 'req-actual',
      }),
    });

    const result = await generateImage(
      { model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH },
      deps
    );

    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('Cost (estimate): $0.005000 per megapixel')
    );
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('× 0.79 MP (planned output) ≈ $0.003932')
    );
    const logOrder = (deps.log as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const subscribeOrder = (deps.falSubscribe as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    expect(logOrder).toBeLessThan(subscribeOrder as number);

    expect(result.costLines[0]).toBe(
      'Estimated cost: $0.005000 per megapixel (list price as of 2026-10-25; live lookup unavailable) × 0.26 MP (actual 512x512) ≈ $0.001311'
    );
    expect(result.costLines[1]).toBe(
      'fal returns no billed cost; check the fal dashboard for the actual bill.'
    );
  });

  it('falls back to the planned estimate when fal returns no dimensions', async () => {
    const deps = createDeps({
      falSubscribe: vi.fn().mockResolvedValue({
        data: { images: [{ url: IMAGE_URL, content_type: 'image/png' }] },
        requestId: 'req-no-dims',
      }),
    });

    const result = await generateImage(
      { model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH },
      deps
    );

    expect(result.costLines[0]).toContain('Estimated cost (planned size)');
    expect(result.costLines[0]).toContain('planned output');
  });

  it('falls back to the planned estimate for a zero output dimension', async () => {
    const deps = createDeps({
      falSubscribe: vi.fn().mockResolvedValue({
        data: {
          images: [{ url: IMAGE_URL, content_type: 'image/png', width: 0, height: 0 }],
        },
        requestId: 'req-zero-dims',
      }),
    });

    const result = await generateImage(
      { model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH },
      deps
    );

    expect(result.costLines[0]).toContain('Estimated cost (planned size)');
    expect(result.costLines[0]).toContain('planned output');
    expect(result.costLines.join('\n')).not.toContain('NaN');
  });

  it('computes the post-call edit estimate from actual output dimensions', async () => {
    const deps = createDeps({
      pathStatus: pathStatusFor({ [INPUT_IMAGE]: 'file' }),
      readFileBytes: vi.fn().mockResolvedValue(pngBytes(512, 512)),
      falSubscribe: vi.fn().mockResolvedValue({
        data: {
          images: [{ url: IMAGE_URL, content_type: 'image/png', width: 1024, height: 1024 }],
        },
        requestId: 'req-edit-actual',
      }),
    });

    const result = await generateImage(
      {
        model: FLUX_2_FLASH_EDIT_MODEL,
        prompt: 'make it stormy',
        out: OUT_PATH,
        inputImage: INPUT_IMAGE,
      },
      deps
    );

    expect(result.costLines[0]).toContain(
      '× 2.05 MP (actual 1024x1024; 1.00 MP input + 1.05 MP output)'
    );
    expect(result.costLines[0]).toContain('≈ $0.01024');
  });

  it('falls back to the list price when lookupPrices rejects', async () => {
    const deps = createDeps({
      lookupPrices: vi.fn().mockRejectedValue(new Error('pricing offline')),
    });

    const plan = await planGenerateImage(
      { model: FLUX_2_FLASH_MODEL, prompt: 'a hero', out: OUT_PATH },
      deps
    );
    const text = formatGenerateImagePlan(plan);

    expect(text).toContain('Cost (estimate): $0.005000 per megapixel');
    expect(text).toContain('list price as of 2026-10-25; live lookup unavailable');
    expect(text).not.toContain('Cost: unknown');
  });

  it('keeps unknown cost for a model with no rate data', async () => {
    const deps = createDeps({ lookupPrices: vi.fn(async () => new Map()) });

    const result = await generateImage(
      { model: 'acme/custom', prompt: 'a hero', out: OUT_PATH },
      deps
    );

    expect(result.costLines[0]).toBe('Estimated cost: unknown for acme/custom; no rate data.');
  });

  it('surfaces an upload failure as GenerateImageError and never calls fal', async () => {
    const deps = createDeps({
      pathStatus: pathStatusFor({ [INPUT_IMAGE]: 'file' }),
      uploadFile: vi
        .fn()
        .mockRejectedValue(new GenerateImageError(`Failed to upload input image ${INPUT_IMAGE}`)),
    });

    const error = await captureError(
      generateImage(
        {
          model: FLUX_2_FLASH_EDIT_MODEL,
          prompt: 'a hero',
          out: OUT_PATH,
          inputImage: INPUT_IMAGE,
        },
        deps
      )
    );

    expect(error).toBeInstanceOf(GenerateImageError);
    expect(error.message).toContain(`Failed to upload input image ${INPUT_IMAGE}`);
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });
});
