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
import { RIGGING_ENDPOINT, RIGGING_MULTI_ANIMATION_ENDPOINT } from './rigging.js';

const FAL_API_KEY = 'fal-api-key-should-never-be-written';
const MESHY_TEXT = 'meshy/v7.1/text-to-3d';
const MESHY_IMAGE = 'meshy/v7.1/image-to-3d';
const TRELLIS_2 = 'fal-ai/trellis-2';

const OUT_PATH = '/tmp/generated/hero.glb';
const MANIFEST_PATH = `${OUT_PATH}.json`;
const RIGGED_OUT_PATH = '/tmp/generated/hero.rigged.glb';
const ANIM_0_PATH = '/tmp/generated/hero.anim-0.glb';
const ANIM_92_PATH = '/tmp/generated/hero.anim-92.glb';
const INPUT_IMAGE = '/tmp/inputs/hero.png';
const UPLOADED_IMAGE_URL = 'https://fal.test/uploaded/hero.png';
const GLB_URL = 'https://fal.test/generated/hero.glb';
const BASE_COLOR_URL = 'https://fal.test/generated/base-color.png';
const RIGGED_GLB_URL = 'https://fal.test/rigged/hero.rigged.glb';
const RIGGED_FBX_URL = 'https://fal.test/rigged/hero.rigged.fbx';
const ANIM_0_URL = 'https://fal.test/anim/hero.anim-0.glb';
const ANIM_92_URL = 'https://fal.test/anim/hero.anim-92.glb';
const RIGGING_REQUEST_ID = 'rig-456';

/** GLB magic "glTF" followed by version 2 and no body. */
const GLB_BYTES = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00]);

/** Stand-in web variant and zip; the real optimiser runs in web-variant.test.ts. */
const WEB_GLB_BYTES = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00, 1, 2, 3]);
const ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9]);
const SOURCE_TEXTURES = [{ width: 2048, height: 2048, mimeType: 'image/png' }];
const WEB_TEXTURES = [{ width: 1024, height: 1024, mimeType: 'image/jpeg' }];

/** The default template's name for the fixed clock in `createDeps`. */
const PACKAGE_NAME = 'hero-20261027-000000';

const ZIP_PATH = `/tmp/generated/${PACKAGE_NAME}.zip`;

const MESHY_FIXTURE = {
  model_glb: { url: GLB_URL, content_type: 'model/gltf-binary' },
  texture_urls: [{ base_color: { url: BASE_COLOR_URL } }],
};

/** A rig-only result: rigged character, FBX, and basic walking/running URLs. */
const RIGGING_FIXTURE = {
  rigged_character_glb: { url: RIGGED_GLB_URL },
  rigged_character_fbx: { url: RIGGED_FBX_URL },
  basic_animations: {
    walking_glb: { url: 'https://fal.test/basic/walking.glb' },
    running_glb: { url: 'https://fal.test/basic/running.glb' },
  },
  rig_task_id: RIGGING_REQUEST_ID,
};

/** A multi-animation result; clips arrive in the requested order. */
const MULTI_ANIMATION_FIXTURE = {
  ...RIGGING_FIXTURE,
  animations: [
    { action_id: 0, animation_glb: { url: ANIM_0_URL } },
    { action_id: 92, animation_glb: { url: ANIM_92_URL } },
  ],
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
    createWebVariant: vi.fn().mockResolvedValue({
      bytes: WEB_GLB_BYTES,
      triangles: 2,
      simplified: false,
      textures: WEB_TEXTURES,
      extensionsUsed: [],
      source: { triangles: 27_438, textures: SOURCE_TEXTURES, extensionsUsed: [] },
    }),
    zipPackage: vi.fn().mockReturnValue(ZIP_BYTES),
    now: () => new Date('2026-10-27T00:00:00.000Z'),
    sdkVersion: '1.10.1',
    ...overrides,
  };
}

/**
 * Deps whose subscription answers the mesh call and then the rigging call, so
 * the two paid steps never touch the network.
 */
function createRigDeps(
  rigFixture: unknown = RIGGING_FIXTURE,
  overrides: Partial<Generate3dDeps> = {}
): Generate3dDeps {
  const falSubscribe = vi.fn().mockImplementation(async (model: string) => {
    if (model === MESHY_TEXT) return { requestId: 'req-123', data: MESHY_FIXTURE };
    return { requestId: RIGGING_REQUEST_ID, data: rigFixture };
  });
  return createDeps({ falSubscribe, ...overrides });
}

function writtenManifest(deps: Generate3dDeps): Generate3dManifest {
  const call = vi.mocked(deps.writeJson).mock.calls[0];
  if (call === undefined) throw new Error('expected a manifest write');
  return call[1] as Generate3dManifest;
}

/** The final manifest write, which carries the rigging section after `--rig`. */
function lastWrittenManifest(deps: Generate3dDeps): Generate3dManifest {
  const calls = vi.mocked(deps.writeJson).mock.calls;
  const call = calls[calls.length - 1];
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

describe('generate3d packaging', () => {
  /** The package manifest parsed back out of the zip entries. */
  function zippedManifest(deps: Generate3dDeps): Record<string, unknown> {
    const entries = vi.mocked(deps.zipPackage).mock.calls[0]?.[0];
    const manifestEntry = entries?.find((entry) => entry.path === 'manifest.json');
    if (manifestEntry === undefined) throw new Error('expected a manifest.json zip entry');
    return JSON.parse(new TextDecoder().decode(manifestEntry.bytes)) as Record<string, unknown>;
  }

  it('writes the zip with the master, the web variant, and a manifest', async () => {
    const deps = createDeps();

    const result = await generate3d(
      { model: MESHY_TEXT, prompt: '  a knight  ', out: OUT_PATH },
      deps
    );

    expect(result.zipPath).toBe(ZIP_PATH);
    expect(deps.writeFile).toHaveBeenCalledWith(OUT_PATH, GLB_BYTES);
    expect(deps.writeFile).toHaveBeenCalledWith(ZIP_PATH, ZIP_BYTES);
    expect(deps.createWebVariant).toHaveBeenCalledWith(GLB_BYTES, {
      triangleTarget: 30_000,
      maxTexturePx: 1024,
      quality: 80,
    });

    const entries = vi.mocked(deps.zipPackage).mock.calls[0]?.[0] ?? [];
    expect(entries.map((entry) => entry.path)).toEqual([
      'hero.glb',
      'web/hero.web.glb',
      'manifest.json',
    ]);
    expect(entries[1]?.bytes).toEqual(WEB_GLB_BYTES);
  });

  it('records both variants, the generator, and the price caveat in the package manifest', async () => {
    const deps = createDeps();

    await generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH }, deps);

    const sha256 = createHash('sha256').update(GLB_BYTES).digest('hex');
    expect(zippedManifest(deps)).toMatchObject({
      schemaVersion: 1,
      package: {
        name: PACKAGE_NAME,
        zip: `${PACKAGE_NAME}.zip`,
        createdAt: '2026-10-27T00:00:00.000Z',
      },
      generator: {
        tool: 'chatroom generate-3d',
        model: MESHY_TEXT,
        requestId: 'req-123',
        prompt: 'a knight',
        inputImage: null,
      },
      licence: 'commercial',
      pricing: {
        estimatedTotalUsd: 1.2,
        note: 'list-price estimate, not a billed amount',
      },
    });

    const variants = zippedManifest(deps)['variants'] as Record<string, unknown>[];
    expect(variants[0]).toMatchObject({
      name: 'master',
      file: 'hero.glb',
      bytes: GLB_BYTES.byteLength,
      sha256,
      triangles: 27_438,
      textures: SOURCE_TEXTURES,
      extensionsUsed: [],
    });
    expect(variants[0]).not.toHaveProperty('settings');
    expect(variants[1]).toMatchObject({
      name: 'web',
      file: 'web/hero.web.glb',
      bytes: WEB_GLB_BYTES.byteLength,
      triangles: 2,
      textures: WEB_TEXTURES,
      extensionsUsed: [],
      settings: {
        maxTexturePx: 1024,
        textureFormat: 'jpeg',
        quality: 80,
        triangleTarget: 30_000,
        simplified: false,
      },
    });
  });

  it('records the input image path for an image-to-3D run', async () => {
    const deps = createDeps({ pathStatus: vi.fn(existingFiles(INPUT_IMAGE)) });

    await generate3d({ model: MESHY_IMAGE, inputImage: INPUT_IMAGE, out: OUT_PATH }, deps);

    expect(zippedManifest(deps)['generator']).toMatchObject({ inputImage: INPUT_IMAGE });
  });

  it('honours --name and --package-dir', async () => {
    const deps = createDeps();

    const result = await generate3d(
      {
        model: MESHY_TEXT,
        prompt: 'a knight',
        out: OUT_PATH,
        name: '{stem}-{requestId8}',
        packageDir: '/tmp/packages',
      },
      deps
    );

    expect(result.zipPath).toBe('/tmp/packages/hero-req-123.zip');
    expect(deps.writeFile).toHaveBeenCalledWith('/tmp/packages/hero-req-123.zip', ZIP_BYTES);
    // The package directory is created before the paid call, when the exact
    // name is still unknown, so only the directory is asserted.
    expect(deps.ensureParentDir).toHaveBeenCalledWith(expect.stringContaining('/tmp/packages/'));
    expect(zippedManifest(deps)['package']).toMatchObject({ name: 'hero-req-123' });
  });

  it('refuses an existing package without --force before the paid call', async () => {
    const deps = createDeps({ pathStatus: vi.fn(existingFiles(ZIP_PATH)) });

    await expect(
      generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH }, deps)
    ).rejects.toThrow(/Package already exists.*--force/);

    expect(deps.falSubscribe).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('re-checks a deferred {requestId8} package after the call and writes nothing', async () => {
    const deps = createDeps({
      pathStatus: vi.fn(existingFiles('/tmp/generated/hero-req-123.zip')),
    });

    await expect(
      generate3d(
        { model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH, name: '{stem}-{requestId8}' },
        deps
      )
    ).rejects.toThrow(/Package already exists.*--force/);

    // The name is only known after the paid call, so the call happened.
    expect(deps.falSubscribe).toHaveBeenCalledTimes(1);
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.writeJson).not.toHaveBeenCalled();
  });

  it('rejects an invalid --name before any fal call', async () => {
    const deps = createDeps();

    await expect(
      generate3d(
        { model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH, name: 'nested/{stem}' },
        deps
      )
    ).rejects.toThrow(/path separator/);

    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('keeps the master and sidecar but writes no zip when the web variant fails', async () => {
    const deps = createDeps({
      createWebVariant: vi.fn().mockRejectedValue(new Error('sharp is not installed')),
    });

    await expect(
      generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH }, deps)
    ).rejects.toThrow(/web variant: sharp is not installed.*hero\.glb/);

    expect(deps.writeFile).toHaveBeenCalledWith(OUT_PATH, GLB_BYTES);
    expect(deps.writeJson).toHaveBeenCalledTimes(1);
    expect(deps.zipPackage).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalledWith(ZIP_PATH, expect.anything());
  });

  it('writes no zip when the zip builder fails, and keeps the master', async () => {
    const deps = createDeps({
      zipPackage: vi.fn().mockImplementation(() => {
        throw new Error('deflate exploded');
      }),
    });

    await expect(
      generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH }, deps)
    ).rejects.toThrow(/package zip: deflate exploded/);

    expect(deps.writeFile).toHaveBeenCalledWith(OUT_PATH, GLB_BYTES);
    expect(deps.writeFile).not.toHaveBeenCalledWith(ZIP_PATH, expect.anything());
  });
});

describe('generate3d --rig', () => {
  it('rigs the generated mesh, writes the rigged GLB, and adds the manifest section', async () => {
    const deps = createRigDeps();

    const result = await generate3d(
      { model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH, rig: true },
      deps
    );

    expect(deps.falSubscribe).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deps.falSubscribe).mock.calls[0]).toEqual([
      MESHY_TEXT,
      { prompt: 'a knight' },
    ]);
    expect(vi.mocked(deps.falSubscribe).mock.calls[1]).toEqual([
      RIGGING_ENDPOINT,
      { model_url: GLB_URL },
    ]);

    expect(deps.fetchGlb).toHaveBeenCalledWith(RIGGED_GLB_URL);
    expect(deps.writeFile).toHaveBeenCalledWith(RIGGED_OUT_PATH, GLB_BYTES);
    expect(deps.writeJson).toHaveBeenCalledTimes(2);

    expect(writtenManifest(deps).rigging).toBeUndefined();
    const manifest = lastWrittenManifest(deps);
    expect(manifest.requestId).toBe('req-123');
    expect(manifest.rigging).toEqual({
      endpoint: RIGGING_ENDPOINT,
      requestId: RIGGING_REQUEST_ID,
      input: { model_url: GLB_URL },
      riggedGlbPath: RIGGED_OUT_PATH,
      riggedGlbUrl: RIGGED_GLB_URL,
      riggedFbxUrl: RIGGED_FBX_URL,
      basicAnimationUrls: {
        walking_glb: 'https://fal.test/basic/walking.glb',
        running_glb: 'https://fal.test/basic/running.glb',
      },
      animations: [],
      costLines: [{ label: 'rigging (Meshy) $0.20', usd: 0.2 }],
    });

    const cost = result.costLines.join('\n');
    expect(cost).toContain('- rigging (Meshy) $0.20');
    expect(cost).toContain('Estimated total: $1.40');
  });

  it('downloads one GLB per requested animation clip', async () => {
    const deps = createRigDeps(MULTI_ANIMATION_FIXTURE);

    const result = await generate3d(
      {
        model: MESHY_TEXT,
        prompt: 'a knight',
        out: OUT_PATH,
        rig: true,
        animationActionIds: ['0', '92'],
      },
      deps
    );

    expect(vi.mocked(deps.falSubscribe).mock.calls[1]).toEqual([
      RIGGING_MULTI_ANIMATION_ENDPOINT,
      { model_url: GLB_URL, animation_action_ids: [0, 92] },
    ]);
    expect(deps.fetchGlb).toHaveBeenCalledWith(ANIM_0_URL);
    expect(deps.fetchGlb).toHaveBeenCalledWith(ANIM_92_URL);
    expect(deps.writeFile).toHaveBeenCalledWith(ANIM_0_PATH, GLB_BYTES);
    expect(deps.writeFile).toHaveBeenCalledWith(ANIM_92_PATH, GLB_BYTES);

    expect(lastWrittenManifest(deps).rigging?.animations).toEqual([
      { actionId: 0, path: ANIM_0_PATH, glbUrl: ANIM_0_URL },
      { actionId: 92, path: ANIM_92_PATH, glbUrl: ANIM_92_URL },
    ]);
    const cost = result.costLines.join('\n');
    expect(cost).toContain('- animation clips (2) $0.12 each = $0.24');
    expect(cost).toContain('Estimated total: $1.64');
  });

  it('rejects --animation-action-id without --rig before any call or write', async () => {
    const deps = createRigDeps();

    await expect(
      generate3d(
        { model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH, animationActionIds: ['0'] },
        deps
      )
    ).rejects.toThrow('--animation-action-id requires --rig.');

    expect(deps.pathStatus).not.toHaveBeenCalled();
    expect(deps.falSubscribe).not.toHaveBeenCalled();
    expect(deps.fetchGlb).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.writeJson).not.toHaveBeenCalled();
  });

  it('rejects an invalid clip id before any paid call', async () => {
    const deps = createRigDeps();

    await expect(
      generate3d(
        {
          model: MESHY_TEXT,
          prompt: 'a knight',
          out: OUT_PATH,
          rig: true,
          animationActionIds: ['697'],
        },
        deps
      )
    ).rejects.toThrow(/integer from 0 to 696/);
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('refuses an existing rigged GLB without --force', async () => {
    const deps = createRigDeps(RIGGING_FIXTURE, {
      pathStatus: vi.fn(existingFiles(RIGGED_OUT_PATH)),
    });

    await expect(
      generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH, rig: true }, deps)
    ).rejects.toThrow(/Rigged GLB already exists.*--force/);

    expect(deps.falSubscribe).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('refuses an existing animation clip without --force', async () => {
    const deps = createRigDeps(MULTI_ANIMATION_FIXTURE, {
      pathStatus: vi.fn(existingFiles(ANIM_92_PATH)),
    });

    await expect(
      generate3d(
        {
          model: MESHY_TEXT,
          prompt: 'a knight',
          out: OUT_PATH,
          rig: true,
          animationActionIds: ['0', '92'],
        },
        deps
      )
    ).rejects.toThrow(/Animation clip 92 GLB already exists.*--force/);

    expect(deps.falSubscribe).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('keeps the mesh and generation-only manifest when rigging fails', async () => {
    const deps = createRigDeps({});

    await expect(
      generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH, rig: true }, deps)
    ).rejects.toThrow(/Rigging failed for request rig-456.*rigged_character_glb\.url.*hero\.glb/);

    expect(deps.writeFile).toHaveBeenCalledTimes(1);
    expect(deps.writeFile).toHaveBeenCalledWith(OUT_PATH, GLB_BYTES);
    expect(deps.writeJson).toHaveBeenCalledTimes(1);
    expect(writtenManifest(deps).rigging).toBeUndefined();
  });

  it('keeps the mesh and names the rig endpoint when the rigging call fails', async () => {
    const deps = createRigDeps(RIGGING_FIXTURE, {
      falSubscribe: vi
        .fn()
        .mockResolvedValueOnce({ requestId: 'req-123', data: MESHY_FIXTURE })
        .mockRejectedValueOnce(new Error('rig queue exploded')),
    });

    await expect(
      generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH, rig: true }, deps)
    ).rejects.toThrow(/Rigging failed \(fal-ai\/meshy\/rigging\).*rig queue exploded.*hero\.glb/);

    expect(deps.writeFile).toHaveBeenCalledTimes(1);
    expect(deps.writeJson).toHaveBeenCalledTimes(1);
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

  it('formats the rigging request, paths, warning, and cost lines for --dry-run', async () => {
    const deps = createDeps();

    const plan = await planGenerate3d(
      {
        model: MESHY_TEXT,
        prompt: 'a knight',
        out: OUT_PATH,
        rig: true,
        animationActionIds: ['0', '92'],
      },
      deps
    );
    const text = formatGenerate3dPlan(plan);

    expect(plan.riggedOutPath).toBe(RIGGED_OUT_PATH);
    expect(plan.animationOutPaths).toEqual([
      { actionId: 0, path: ANIM_0_PATH },
      { actionId: 92, path: ANIM_92_PATH },
    ]);
    expect(text).toContain(`Rigging request (${RIGGING_MULTI_ANIMATION_ENDPOINT}):`);
    expect(text).toContain('"model_url": "<generated mesh GLB URL>"');
    expect(text).toContain('"animation_action_ids"');
    expect(text).toContain(`Rigged GLB ${RIGGED_OUT_PATH}`);
    expect(text).toContain(`Animation clip 0 ${ANIM_0_PATH}`);
    expect(text).toContain(`Animation clip 92 ${ANIM_92_PATH}`);
    expect(text).toContain(
      'Rigging (Meshy) expects a humanoid mesh; non-humanoid meshes fail on fal.'
    );
    expect(text).toContain('- rigging (Meshy) $0.20');
    expect(text).toContain('- animation clips (2) $0.12 each = $0.24');
    expect(text).toContain('Estimated total: $1.64');

    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.falSubscribe).not.toHaveBeenCalled();
    expect(deps.fetchGlb).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.writeJson).not.toHaveBeenCalled();
  });

  it('checks the planned rigged and clip paths for conflicts', async () => {
    const deps = createDeps({
      pathStatus: vi.fn(existingFiles(ANIM_0_PATH)),
    });

    await expect(
      planGenerate3d(
        {
          model: MESHY_TEXT,
          prompt: 'a knight',
          out: OUT_PATH,
          rig: true,
          animationActionIds: ['0'],
        },
        deps
      )
    ).rejects.toThrow(/Animation clip 0 GLB already exists.*--force/);
  });

  it('rejects an invalid clip id before touching the filesystem', async () => {
    const deps = createDeps();

    await expect(
      planGenerate3d(
        {
          model: MESHY_TEXT,
          prompt: 'a knight',
          out: OUT_PATH,
          rig: true,
          animationActionIds: ['1.5'],
        },
        deps
      )
    ).rejects.toThrow(/integer from 0 to 696/);
    expect(deps.pathStatus).not.toHaveBeenCalled();
  });

  it('has no rigging section or cost when --rig is absent', async () => {
    const deps = createDeps();

    const plan = await planGenerate3d(
      { model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH },
      deps
    );

    expect(plan.riggingRequest).toBeNull();
    expect(plan.riggedOutPath).toBeNull();
    expect(plan.animationOutPaths).toEqual([]);
    expect(plan.costLines).toEqual(
      expect.arrayContaining([
        { label: 'base $0.80', usd: 0.8 },
        { label: 'textures +$0.40', usd: 0.4 },
      ])
    );
    expect(formatGenerate3dPlan(plan)).not.toContain('Rigging request');
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
