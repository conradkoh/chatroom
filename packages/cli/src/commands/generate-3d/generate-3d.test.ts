/**
 * Generate 3D unit tests.
 *
 * Exercises the pure generation logic with injected deps only. No network,
 * no filesystem, and no real fal generation call. The one exception is
 * `fetchGlb`, whose real implementation is checked against a stubbed global
 * fetch because the GLB magic check is the safety gate for the output file.
 */

import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDefaultGenerate3dDeps, type Generate3dDeps } from './deps.js';
import {
  formatGenerate3dPlan,
  generate3d,
  planGenerate3d,
  type Generate3dManifest,
} from './generate-3d.js';

const FAL_API_KEY = 'fal-api-key-should-never-be-written';
const MESHY_TEXT = 'meshy/v7.1/text-to-3d';
const MESHY_IMAGE = 'meshy/v7.1/image-to-3d';
const TRELLIS_2 = 'fal-ai/trellis-2';

const OUT_PATH = '/tmp/generated/hero.glb';
const MANIFEST_PATH = `${OUT_PATH}.json`;
const INPUT_IMAGE = '/tmp/inputs/hero.png';
const UPLOADED_IMAGE_URL = 'https://fal.test/uploaded/hero.png';
const GLB_URL = 'https://fal.test/generated/hero.glb';
const BASE_COLOR_URL = 'https://fal.test/generated/base-color.png';

/** GLB magic "glTF" followed by version 2 and no body. */
const GLB_BYTES = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00]);

const MESHY_FIXTURE = {
  model_glb: { url: GLB_URL, content_type: 'model/gltf-binary' },
  texture_urls: [{ base_color: { url: BASE_COLOR_URL } }],
};

function createDeps(overrides: Partial<Generate3dDeps> = {}): Generate3dDeps {
  return {
    env: { FAL_API_KEY },
    falSubscribe: vi.fn().mockResolvedValue({ requestId: 'req-123', data: MESHY_FIXTURE }),
    fetchGlb: vi.fn().mockResolvedValue(GLB_BYTES),
    uploadFile: vi.fn().mockResolvedValue(UPLOADED_IMAGE_URL),
    writeFile: vi.fn().mockResolvedValue(undefined),
    writeJson: vi.fn().mockResolvedValue(undefined),
    pathStatus: vi.fn().mockResolvedValue('missing'),
    ensureParentDir: vi.fn().mockResolvedValue(undefined),
    now: () => new Date('2026-10-27T00:00:00.000Z'),
    sdkVersion: '1.10.1',
    ...overrides,
  };
}

function writtenManifest(deps: Generate3dDeps): Generate3dManifest {
  const call = vi.mocked(deps.writeJson).mock.calls[0];
  if (call === undefined) throw new Error('expected a manifest write');
  return call[1] as Generate3dManifest;
}

/** Path status where only the given paths exist as files. */
function existingFiles(...paths: string[]): (path: string) => Promise<'missing' | 'file'> {
  return async (path) => (paths.includes(path) ? 'file' : 'missing');
}

describe('generate3d', () => {
  it('sends a text prompt and writes the GLB plus a manifest', async () => {
    const deps = createDeps();

    const result = await generate3d(
      { model: MESHY_TEXT, prompt: '  a knight  ', out: OUT_PATH },
      deps
    );

    expect(deps.falSubscribe).toHaveBeenCalledTimes(1);
    const [model, input] = vi.mocked(deps.falSubscribe).mock.calls[0] ?? [];
    expect(model).toBe(MESHY_TEXT);
    expect(input).toEqual({ prompt: 'a knight' });
    expect(input).not.toHaveProperty('image_url');
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.ensureParentDir).toHaveBeenCalledWith(OUT_PATH);

    expect(deps.fetchGlb).toHaveBeenCalledWith(GLB_URL);
    expect(deps.writeFile).toHaveBeenCalledWith(OUT_PATH, GLB_BYTES);
    expect(deps.writeJson).toHaveBeenCalledTimes(1);

    const sha256 = createHash('sha256').update(GLB_BYTES).digest('hex');
    const manifest = writtenManifest(deps);
    expect(manifest).toMatchObject({
      platform: 'fal',
      tool: 'chatroom generate-3d',
      sdk: '@fal-ai/client@1.10.1',
      model: MESHY_TEXT,
      pageUrl: 'https://fal.ai/models/meshy/v7.1/text-to-3d',
      licenseType: 'commercial',
      input: { prompt: 'a knight' },
      inputImage: null,
      requestId: 'req-123',
      output: {
        path: OUT_PATH,
        sha256,
        bytes: GLB_BYTES.byteLength,
        contentType: 'model/gltf-binary',
      },
      textureUrls: [BASE_COLOR_URL],
      generatedAt: '2026-10-27T00:00:00.000Z',
    });

    expect(result).toMatchObject({ outPath: OUT_PATH, manifestPath: MANIFEST_PATH, sha256 });
    expect(result.costLines[0]).toContain('2026-10-27');
    expect(result.costLines.join('\n')).toContain('fal returns no billed cost');
  });

  it('uploads a local input image and sends the returned URL', async () => {
    const deps = createDeps({ pathStatus: vi.fn(existingFiles(INPUT_IMAGE)) });

    await generate3d({ model: MESHY_IMAGE, inputImage: INPUT_IMAGE, out: OUT_PATH }, deps);

    expect(deps.uploadFile).toHaveBeenCalledWith(INPUT_IMAGE, 'image/png');
    expect(deps.falSubscribe).toHaveBeenCalledWith(MESHY_IMAGE, {
      image_url: UPLOADED_IMAGE_URL,
    });
    expect(writtenManifest(deps).inputImage).toEqual({
      source: INPUT_IMAGE,
      url: UPLOADED_IMAGE_URL,
    });
  });

  it('passes an http input URL through without uploading', async () => {
    const source = 'https://example.test/source/hero.webp';
    const deps = createDeps();

    await generate3d({ model: TRELLIS_2, inputImage: source, out: OUT_PATH }, deps);

    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.falSubscribe).toHaveBeenCalledWith(TRELLIS_2, {
      image_url: source,
      resolution: 1024,
    });
    expect(writtenManifest(deps).inputImage).toEqual({ source, url: source });
  });

  it('rejects an unknown model before any upload or fal call', async () => {
    const deps = createDeps();

    await expect(
      generate3d({ model: 'fal-ai/flux/dev', prompt: 'a knight', out: OUT_PATH }, deps)
    ).rejects.toThrow(/Unknown --model fal-ai\/flux\/dev.*meshy\/v7\.1\/text-to-3d/);

    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.falSubscribe).not.toHaveBeenCalled();
    expect(deps.fetchGlb).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.writeJson).not.toHaveBeenCalled();
  });

  it('rejects --input-image on a text model', async () => {
    const deps = createDeps();

    await expect(
      generate3d(
        { model: MESHY_TEXT, prompt: 'a knight', inputImage: INPUT_IMAGE, out: OUT_PATH },
        deps
      )
    ).rejects.toThrow(/text-to-3D model.*--prompt, not --input-image/);
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('rejects a missing --prompt on a text model', async () => {
    const deps = createDeps();

    await expect(generate3d({ model: MESHY_TEXT, out: OUT_PATH }, deps)).rejects.toThrow(
      /--prompt is required/
    );
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('rejects an image model without --input-image', async () => {
    const deps = createDeps();

    await expect(generate3d({ model: MESHY_IMAGE, out: OUT_PATH }, deps)).rejects.toThrow(
      /--input-image is required/
    );
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('rejects --prompt on an image model', async () => {
    const deps = createDeps();

    await expect(
      generate3d(
        { model: TRELLIS_2, prompt: 'a knight', inputImage: INPUT_IMAGE, out: OUT_PATH },
        deps
      )
    ).rejects.toThrow(/image-to-3D model.*--input-image, not --prompt/);
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('requires a .glb output path', async () => {
    const deps = createDeps();

    await expect(
      generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: '/tmp/hero.obj' }, deps)
    ).rejects.toThrow(/--out must end with \.glb/);
  });

  it('refuses an existing output without --force and writes nothing', async () => {
    const deps = createDeps({ pathStatus: vi.fn(existingFiles(OUT_PATH)) });

    await expect(
      generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH }, deps)
    ).rejects.toThrow(/--out already exists.*--force/);

    expect(deps.falSubscribe).not.toHaveBeenCalled();
    expect(deps.fetchGlb).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.writeJson).not.toHaveBeenCalled();
  });

  it('refuses an existing manifest without --force', async () => {
    const deps = createDeps({ pathStatus: vi.fn(existingFiles(MANIFEST_PATH)) });

    await expect(
      generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH }, deps)
    ).rejects.toThrow(/Manifest already exists.*--force/);

    expect(deps.falSubscribe).not.toHaveBeenCalled();
    expect(deps.writeJson).not.toHaveBeenCalled();
  });

  it('refuses a local input image that does not exist', async () => {
    const deps = createDeps();

    await expect(
      generate3d({ model: MESHY_IMAGE, inputImage: INPUT_IMAGE, out: OUT_PATH }, deps)
    ).rejects.toThrow(/--input-image is not a file/);
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('overwrites an existing output with --force', async () => {
    const deps = createDeps({ pathStatus: vi.fn(existingFiles(OUT_PATH)) });

    await generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH, force: true }, deps);

    expect(deps.writeFile).toHaveBeenCalledWith(OUT_PATH, GLB_BYTES);
  });

  it('refuses a directory output', async () => {
    const deps = createDeps({ pathStatus: vi.fn().mockResolvedValue('directory') });

    await expect(
      generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH }, deps)
    ).rejects.toThrow(/--out is a directory/);
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('requires FAL_API_KEY before any fal or filesystem work', async () => {
    const deps = createDeps({ env: {} });

    await expect(
      generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH }, deps)
    ).rejects.toThrow(/FAL_API_KEY is not set/);
    expect(deps.pathStatus).not.toHaveBeenCalled();
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('names the request id and GLB URL when the download fails', async () => {
    const deps = createDeps({
      fetchGlb: vi.fn().mockRejectedValue(new Error('connection reset')),
    });

    await expect(
      generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH }, deps)
    ).rejects.toThrow(/req-123.*hero\.glb.*connection reset/);
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.writeJson).not.toHaveBeenCalled();
  });

  it('rejects a local input image in a format the models do not accept', async () => {
    const deps = createDeps();

    await expect(
      generate3d({ model: MESHY_IMAGE, inputImage: '/tmp/inputs/hero.webp', out: OUT_PATH }, deps)
    ).rejects.toThrow(/Unsupported --input-image extension \.webp/);
    expect(deps.pathStatus).not.toHaveBeenCalled();
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('rejects a result with no GLB URL and writes nothing', async () => {
    const deps = createDeps({
      falSubscribe: vi.fn().mockResolvedValue({ requestId: 'req-123', data: {} }),
    });

    await expect(
      generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH }, deps)
    ).rejects.toThrow(/no GLB.*req-123/);
    expect(deps.fetchGlb).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.writeJson).not.toHaveBeenCalled();
  });
});

describe('planGenerate3d', () => {
  it('builds the request and cost estimate without upload, fal, or download', async () => {
    const deps = createDeps();

    const plan = await planGenerate3d(
      { model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH },
      deps
    );

    expect(plan.input).toEqual({ prompt: 'a knight' });
    expect(plan.outPath).toBe(OUT_PATH);
    expect(plan.manifestPath).toBe(MANIFEST_PATH);
    expect(deps.pathStatus).toHaveBeenCalled();
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.falSubscribe).not.toHaveBeenCalled();
    expect(deps.fetchGlb).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.writeJson).not.toHaveBeenCalled();
  });

  it('shows a storage placeholder for a local input image', async () => {
    const deps = createDeps({ pathStatus: vi.fn(existingFiles(INPUT_IMAGE)) });

    const plan = await planGenerate3d(
      { model: TRELLIS_2, inputImage: INPUT_IMAGE, out: OUT_PATH },
      deps
    );

    expect(plan.input).toEqual({
      image_url: `<fal storage URL for ${INPUT_IMAGE}>`,
      resolution: 1024,
    });
    const text = formatGenerate3dPlan(plan);
    expect(text).toContain(`Input image ${INPUT_IMAGE} (would be uploaded to fal storage`);
    expect(text).toContain('No upload or fal generation call was made.');
  });

  it('formats the price date, lines, total, and disclaimer', async () => {
    const plan = await planGenerate3d(
      { model: MESHY_IMAGE, inputImage: UPLOADED_IMAGE_URL, out: OUT_PATH },
      createDeps()
    );
    const text = formatGenerate3dPlan(plan);

    expect(text).toContain('Would generate /tmp/generated/hero.glb');
    expect(text).toContain('Manifest /tmp/generated/hero.glb.json');
    expect(text).toContain(`Model ${MESHY_IMAGE} (image-to-3D, licence: commercial)`);
    expect(text).toContain('Input image https://fal.test/uploaded/hero.png (passed through)');
    expect(text).toContain(
      'Cost estimate (prices as of 2026-10-27; estimate; fal returns no billed cost):'
    );
    expect(text).toContain('- base $0.80');
    expect(text).toContain('- textures +$0.40');
    expect(text).toContain('Estimated total: $1.20');
  });

  it('excludes the optional PBR surcharge from the Hunyuan rapid total', async () => {
    const plan = await planGenerate3d(
      {
        model: 'fal-ai/hunyuan-3d/v3.1/rapid/text-to-3d',
        prompt: 'a knight',
        out: OUT_PATH,
      },
      createDeps()
    );
    const text = formatGenerate3dPlan(plan);

    expect(text).toContain('- base $0.225');
    expect(text).toContain('PBR +$0.15 (optional; not requested, excluded from the total)');
    expect(text).toContain('Estimated total: $0.225');
  });
});

describe('createDefaultGenerate3dDeps().fetchGlb', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts a body that starts with the glTF magic', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(GLB_BYTES, { status: 200 })));

    const bytes = await createDefaultGenerate3dDeps().fetchGlb(GLB_URL);

    expect([...bytes]).toEqual([...GLB_BYTES]);
  });

  it('rejects an HTML error page served with HTTP 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response('<!doctype html><title>error</title>', { status: 200 }))
    );

    await expect(createDefaultGenerate3dDeps().fetchGlb(GLB_URL)).rejects.toThrow(/not a GLB/);
  });

  it('rejects a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('missing', { status: 404, statusText: 'Not Found' }))
    );

    await expect(createDefaultGenerate3dDeps().fetchGlb(GLB_URL)).rejects.toThrow(
      /HTTP 404 Not Found/
    );
  });
});
