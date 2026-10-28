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

/** The prompt the packaging tests send; also asserted inside the preview. */
const INPUT_PROMPT = 'a knight';

const ZIP_PATH = `/tmp/generated/${PACKAGE_NAME}.zip`;

/** The options a non-forced package write passes to `deps.writeFile`. */
const EXCLUSIVE = { exclusive: true };
const HTML_PATH = `/tmp/generated/${PACKAGE_NAME}.html`;

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
    removeFile: vi.fn().mockResolvedValue(undefined),
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
    // The sidecar is written once for the generation, then rewritten to link the
    // package files now that their base name is resolved.
    expect(deps.writeJson).toHaveBeenCalledTimes(2);

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

  it('passes an unknown model through with the conventional fields', async () => {
    const deps = createDeps({
      falSubscribe: vi.fn().mockResolvedValue({
        requestId: 'req-123',
        data: { output: { model: { url: 'https://fal.test/future/model.glb' } } },
      }),
    });

    await generate3d(
      { model: 'fal-ai/some-future-model', prompt: '  a knight  ', out: OUT_PATH },
      deps
    );

    expect(deps.falSubscribe).toHaveBeenCalledWith('fal-ai/some-future-model', {
      prompt: 'a knight',
    });
    expect(deps.fetchGlb).toHaveBeenCalledWith('https://fal.test/future/model.glb');
    expect(writtenManifest(deps).model).toBe('fal-ai/some-future-model');
    expect(writtenManifest(deps).licenseType).toBe('unknown');
  });

  it('reports the model, request id, and result keys when an unknown result has no GLB', async () => {
    const deps = createDeps({
      falSubscribe: vi
        .fn()
        .mockResolvedValue({ requestId: 'req-123', data: { nope: 1, other: 2 } }),
    });

    await expect(
      generate3d({ model: 'fal-ai/some-future-model', prompt: 'a knight', out: OUT_PATH }, deps)
    ).rejects.toThrow(/no GLB for model fal-ai\/some-future-model.*nope, other.*req-123/s);

    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.writeJson).not.toHaveBeenCalled();
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
    expect(result.htmlPath).toBe(HTML_PATH);
    expect(deps.writeFile).toHaveBeenCalledWith(OUT_PATH, GLB_BYTES);
    expect(deps.writeFile).toHaveBeenCalledWith(ZIP_PATH, ZIP_BYTES, EXCLUSIVE);
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

  it('writes the preview beside the zip, with the same base name', async () => {
    const deps = createDeps();

    await generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH }, deps);

    const htmlWrite = vi.mocked(deps.writeFile).mock.calls.find(([path]) => path === HTML_PATH);
    expect(htmlWrite).toBeDefined();
    const html = new TextDecoder().decode(htmlWrite?.[1]);
    expect(html).toContain('<model-viewer');
    expect(html).toContain('camera-controls');
    expect(html).toContain(INPUT_PROMPT);
    expect(html).toContain(`${PACKAGE_NAME}.zip`);
  });

  it('refuses an existing preview without --force before the paid call', async () => {
    const deps = createDeps({ pathStatus: vi.fn(existingFiles(HTML_PATH)) });

    await expect(
      generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH }, deps)
    ).rejects.toThrow(/Preview already exists.*--force/);

    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('removes the previous package pair before a --force rewrite', async () => {
    const deps = createDeps();

    await generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH, force: true }, deps);

    const removeCalls = vi.mocked(deps.removeFile);
    const writeCalls = vi.mocked(deps.writeFile);
    const orderOfRemove = (path: string): number => {
      const index = removeCalls.mock.calls.findIndex(([removed]) => removed === path);
      return removeCalls.mock.invocationCallOrder[index] ?? -1;
    };
    const orderOfWrite = (path: string): number => {
      const index = writeCalls.mock.calls.findIndex(([written]) => written === path);
      return writeCalls.mock.invocationCallOrder[index] ?? -1;
    };

    expect(orderOfRemove(ZIP_PATH)).toBeGreaterThan(0);
    expect(orderOfRemove(ZIP_PATH)).toBeLessThan(orderOfWrite(ZIP_PATH));
    expect(orderOfRemove(HTML_PATH)).toBeLessThan(orderOfWrite(HTML_PATH));
    // With --force the pair is written without the exclusive flag.
    expect(writeCalls).toHaveBeenCalledWith(ZIP_PATH, ZIP_BYTES, { exclusive: false });
  });

  it('fails the package on EEXIST without discarding the master or sidecar', async () => {
    const deps = createDeps();
    vi.mocked(deps.writeFile).mockImplementation(async (path) => {
      if (path !== ZIP_PATH) return;
      const error = new Error('EEXIST: file already exists') as NodeJS.ErrnoException;
      error.code = 'EEXIST';
      throw error;
    });

    await expect(
      generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH }, deps)
    ).rejects.toThrow(/save the package .*EEXIST.*hero\.glb/s);

    expect(deps.writeFile).toHaveBeenCalledWith(OUT_PATH, GLB_BYTES);
    expect(deps.writeJson).toHaveBeenCalledTimes(1);
    expect(deps.writeFile).not.toHaveBeenCalledWith(
      HTML_PATH,
      expect.anything(),
      expect.anything()
    );
  });

  it('removes the zip when the preview cannot be written', async () => {
    const deps = createDeps();
    vi.mocked(deps.writeFile).mockImplementation(async (path) => {
      if (path === HTML_PATH) throw new Error('disk full');
    });

    await expect(
      generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH }, deps)
    ).rejects.toThrow(/preview .*disk full.*hero\.glb/s);

    expect(deps.writeFile).toHaveBeenCalledWith(ZIP_PATH, ZIP_BYTES, EXCLUSIVE);
    expect(deps.removeFile).toHaveBeenCalledWith(ZIP_PATH);
  });

  it('reports a rollback failure instead of hiding it', async () => {
    const deps = createDeps();
    vi.mocked(deps.writeFile).mockImplementation(async (path) => {
      if (path === HTML_PATH) throw new Error('disk full');
    });
    vi.mocked(deps.removeFile).mockRejectedValue(new Error('permission denied'));

    await expect(
      generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH }, deps)
    ).rejects.toThrow(/could not be removed/);
  });

  it('writes the master, sidecar, zip, and preview in that order', async () => {
    const deps = createDeps();

    await generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH }, deps);

    const fileCalls = vi.mocked(deps.writeFile);
    const fileOrder = (path: string): number => {
      const index = fileCalls.mock.calls.findIndex(([written]) => written === path);
      return fileCalls.mock.invocationCallOrder[index] ?? -1;
    };
    const sidecarOrder = vi.mocked(deps.writeJson).mock.invocationCallOrder[0] ?? -1;

    expect(fileOrder(OUT_PATH)).toBeGreaterThan(0);
    expect(fileOrder(OUT_PATH)).toBeLessThan(sidecarOrder);
    expect(sidecarOrder).toBeLessThan(fileOrder(ZIP_PATH));
    expect(fileOrder(ZIP_PATH)).toBeLessThan(fileOrder(HTML_PATH));
  });

  it('never writes the API key into the sidecar, a file, or a zip entry', async () => {
    const deps = createDeps();

    await generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH }, deps);

    const sidecarWrites = vi
      .mocked(deps.writeJson)
      .mock.calls.map(([path, value]) => `${String(path)} ${JSON.stringify(value)}`);
    const fileWrites = vi
      .mocked(deps.writeFile)
      .mock.calls.map(
        ([path, bytes]) => `${String(path)} ${Buffer.from(bytes).toString('binary')}`
      );
    const zipEntries = vi
      .mocked(deps.zipPackage)
      .mock.calls.flatMap(([entries]) =>
        entries.map((entry) => `${entry.path} ${Buffer.from(entry.bytes).toString('binary')}`)
      );

    for (const artifact of [...sidecarWrites, ...fileWrites, ...zipEntries]) {
      expect(artifact).not.toContain(FAL_API_KEY);
    }
  });

  it('removes a partially written zip when the zip write fails', async () => {
    const deps = createDeps();
    vi.mocked(deps.writeFile).mockImplementation(async (path) => {
      if (path === ZIP_PATH) throw new Error('no space left on device');
    });

    await expect(
      generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH }, deps)
    ).rejects.toThrow(/save the package .*no space left.*hero\.glb/s);

    expect(deps.removeFile).toHaveBeenCalledWith(ZIP_PATH);
    expect(deps.writeFile).not.toHaveBeenCalledWith(
      HTML_PATH,
      expect.anything(),
      expect.anything()
    );
  });

  it('sanitizes an --out stem with spaces into a valid package name', async () => {
    const outPath = '/tmp/generated/My Chest.glb';
    const deps = createDeps();

    const result = await generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: outPath }, deps);

    expect(result.zipPath).toBe('/tmp/generated/My-Chest-20261027-000000.zip');
    expect(result.htmlPath).toBe('/tmp/generated/My-Chest-20261027-000000.html');
    expect(deps.writeFile).toHaveBeenCalledWith(outPath, GLB_BYTES);
  });

  it('links the package files in the sidecar', async () => {
    const deps = createDeps();

    await generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH }, deps);

    expect(lastWrittenManifest(deps).package).toEqual({
      zip: `${PACKAGE_NAME}.zip`,
      html: `${PACKAGE_NAME}.html`,
    });
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

  it('names the package from the --out stem and the timestamp, in --package-dir', async () => {
    const deps = createDeps();

    const result = await generate3d(
      {
        model: MESHY_TEXT,
        prompt: 'a knight',
        out: OUT_PATH,
        packageDir: '/tmp/packages',
      },
      deps
    );

    // OUT_PATH is /tmp/generated/hero.glb and the fixed clock is 2026-10-27T00:00:00Z.
    expect(result.zipPath).toBe('/tmp/packages/hero-20261027-000000.zip');
    expect(result.htmlPath).toBe('/tmp/packages/hero-20261027-000000.html');
    expect(deps.writeFile).toHaveBeenCalledWith(
      '/tmp/packages/hero-20261027-000000.zip',
      ZIP_BYTES,
      EXCLUSIVE
    );
    expect(deps.ensureParentDir).toHaveBeenCalledWith('/tmp/packages/hero-20261027-000000.zip');
    expect(zippedManifest(deps)['package']).toMatchObject({ name: 'hero-20261027-000000' });
  });

  it('refuses an existing package without --force before the paid call', async () => {
    const deps = createDeps({ pathStatus: vi.fn(existingFiles(ZIP_PATH)) });

    await expect(
      generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH }, deps)
    ).rejects.toThrow(/Package already exists.*--force/);

    expect(deps.falSubscribe).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('refuses an existing preview without --force before the paid call', async () => {
    const deps = createDeps({ pathStatus: vi.fn(existingFiles(HTML_PATH)) });

    await expect(
      generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH }, deps)
    ).rejects.toThrow(/Preview already exists.*--force/);

    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('rejects an --out name that cannot form a package name before any fal call', async () => {
    const deps = createDeps();

    await expect(
      generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: '/tmp/generated/宝箱.glb' }, deps)
    ).rejects.toThrow(/cannot form a package name.*Rename --out/s);

    expect(deps.falSubscribe).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
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

describe('default model and rig gate', () => {
  it('defaults to fal-ai/trellis-2 when --model is omitted', async () => {
    const deps = createDeps();
    const plan = await planGenerate3d(
      { inputImage: 'https://example.test/hero.png', out: OUT_PATH },
      deps
    );

    expect(plan.model.id).toBe('fal-ai/trellis-2');
    expect(plan.input).toEqual({ image_url: 'https://example.test/hero.png', resolution: 1024 });
  });

  it('refuses a prompt with the default model and points at the text-to-3D model', async () => {
    const deps = createDeps();

    await expect(planGenerate3d({ prompt: 'a chest', out: OUT_PATH }, deps)).rejects.toThrow(
      [
        'fal-ai/trellis-2 does not support --prompt "a chest". Omit: --prompt "a chest"',
        'Corrected command:',
        '  chatroom generate-3d --platform=fal --model fal-ai/trellis-2 --input-image PATH_OR_URL --out /tmp/generated/hero.glb',
        'The corrected command still needs an input: replace PATH_OR_URL with your value.',
        'A prompt-only run needs a text-to-3D model: --model meshy/v7.1/text-to-3d.',
      ].join('\n')
    );
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('refuses a real rigging run without --confirm-cost, before any upload', async () => {
    const deps = createRigDeps();

    await expect(
      generate3d({ model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH, rig: true }, deps)
    ).rejects.toThrow(
      /This run rigs and animates with Meshy 7\.1.*Estimated total: \$1\.40.*Add --confirm-cost to run\./s
    );

    expect(deps.falSubscribe).not.toHaveBeenCalled();
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.writeJson).not.toHaveBeenCalled();
  });

  it('rigs a Meshy run once --confirm-cost is given', async () => {
    const deps = createRigDeps();

    const result = await generate3d(
      { model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH, rig: true, confirmCost: true },
      deps
    );

    expect(result.zipPath).toBe(ZIP_PATH);
    expect(deps.falSubscribe).toHaveBeenCalledTimes(2);
  });

  it('accepts --confirm-cost without rigging and changes nothing', async () => {
    const deps = createDeps();

    const result = await generate3d(
      { model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH, confirmCost: true },
      deps
    );

    expect(result.zipPath).toBe(ZIP_PATH);
    expect(deps.falSubscribe).toHaveBeenCalledTimes(1);
    expect(result.costLines.join('\n')).toContain('Estimated total: $1.20');
  });

  it('shows the priced plan and the confirmation line in a dry run', async () => {
    const plan = await planGenerate3d(
      { model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH, rig: true },
      createDeps()
    );
    const text = formatGenerate3dPlan(plan);

    expect(text).toContain('Estimated total: $1.40');
    expect(text).toContain('Add --confirm-cost to run.');
  });

  it('omits the confirmation line when --confirm-cost is set', async () => {
    const plan = await planGenerate3d(
      { model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH, rig: true, confirmCost: true },
      createDeps()
    );

    expect(formatGenerate3dPlan(plan)).not.toContain('Add --confirm-cost to run.');
  });
});

describe('capability checks', () => {
  it('hands a refused rig to Meshy with every flag kept and the cost gate added', async () => {
    const deps = createDeps();

    await expect(
      generate3d(
        {
          model: TRELLIS_2,
          inputImage: './concept.png',
          out: OUT_PATH,
          rig: true,
          confirmCost: true,
          animationActionIds: ['0'],
        },
        deps
      )
    ).rejects.toThrow(
      [
        'fal-ai/trellis-2 cannot rig. Bones and animation come from Meshy 7.1 only.',
        'Omit: --rig, --animation-action-id 0',
        'Corrected command:',
        '  chatroom generate-3d --platform=fal --model meshy/v7.1/image-to-3d --input-image ./concept.png --rig --animation-action-id 0 --confirm-cost --out /tmp/generated/hero.glb',
      ].join('\n')
    );

    expect(deps.falSubscribe).not.toHaveBeenCalled();
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('refuses --prompt for an image-only model and supplies the right input', async () => {
    const deps = createDeps();

    await expect(
      generate3d({ model: TRELLIS_2, prompt: 'a knight', out: OUT_PATH }, deps)
    ).rejects.toThrow(
      [
        'fal-ai/trellis-2 does not support --prompt "a knight". Omit: --prompt "a knight"',
        'Corrected command:',
        '  chatroom generate-3d --platform=fal --model fal-ai/trellis-2 --input-image PATH_OR_URL --out /tmp/generated/hero.glb',
        'The corrected command still needs an input: replace PATH_OR_URL with your value.',
        'A prompt-only run needs a text-to-3D model: --model meshy/v7.1/text-to-3d.',
      ].join('\n')
    );

    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('refuses --input-image for a text-only model and supplies a prompt', async () => {
    const deps = createDeps();

    await expect(
      generate3d({ model: MESHY_TEXT, inputImage: './x.png', out: OUT_PATH }, deps)
    ).rejects.toThrow(
      /meshy\/v7\.1\/text-to-3d does not support --input-image \.\/x\.png.*--prompt TEXT/s
    );

    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('checks flags in the dry-run plan too', async () => {
    await expect(
      planGenerate3d(
        { model: TRELLIS_2, prompt: 'a knight', out: OUT_PATH, dryRun: true },
        createDeps()
      )
    ).rejects.toThrow(/fal-ai\/trellis-2 does not support --prompt/);
  });

  it('refuses rigging on an unknown model, which has no Meshy equivalent', async () => {
    const deps = createDeps();

    await expect(
      planGenerate3d(
        {
          model: 'fal-ai/some-future-model',
          prompt: 'a knight',
          out: OUT_PATH,
          rig: true,
          confirmCost: true,
          animationActionIds: ['0'],
        },
        deps
      )
    ).rejects.toThrow(
      [
        'fal-ai/some-future-model cannot rig. Bones and animation come from Meshy 7.1 only.',
        'Omit: --rig, --animation-action-id 0',
        'Corrected command:',
        "  chatroom generate-3d --platform=fal --model meshy/v7.1/text-to-3d --prompt 'a knight' --rig --animation-action-id 0 --confirm-cost --out /tmp/generated/hero.glb",
      ].join('\n')
    );
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });
});

describe('generate3d --rig', () => {
  it('rigs the generated mesh, writes the rigged GLB, and adds the manifest section', async () => {
    const deps = createRigDeps();

    const result = await generate3d(
      { model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH, rig: true, confirmCost: true },
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
    // generation sidecar, package link, then the rigging rewrite
    expect(deps.writeJson).toHaveBeenCalledTimes(3);

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
        confirmCost: true,
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
          confirmCost: true,
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
      generate3d(
        { model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH, rig: true, confirmCost: true },
        deps
      )
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
          confirmCost: true,
          animationActionIds: ['0', '92'],
        },
        deps
      )
    ).rejects.toThrow(/Animation clip 92 GLB already exists.*--force/);

    expect(deps.falSubscribe).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('keeps the mesh, sidecar, and package when rigging fails', async () => {
    const deps = createRigDeps({});

    await expect(
      generate3d(
        { model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH, rig: true, confirmCost: true },
        deps
      )
    ).rejects.toThrow(/Rigging failed for request rig-456.*rigged_character_glb\.url.*hero\.glb/);

    // The master and the package are both on disk; only rigging is missing.
    expect(deps.writeFile).toHaveBeenCalledWith(OUT_PATH, GLB_BYTES);
    expect(deps.writeFile).toHaveBeenCalledWith(ZIP_PATH, ZIP_BYTES, EXCLUSIVE);
    expect(deps.writeJson).toHaveBeenCalledTimes(2);
    expect(lastWrittenManifest(deps).rigging).toBeUndefined();
    expect(lastWrittenManifest(deps).package).toEqual({
      zip: `${PACKAGE_NAME}.zip`,
      html: `${PACKAGE_NAME}.html`,
    });
  });

  it('still rigs when packaging fails, then reports the packaging error', async () => {
    const deps = createRigDeps(RIGGING_FIXTURE, {
      createWebVariant: vi.fn().mockRejectedValue(new Error('sharp is not installed')),
    });

    await expect(
      generate3d(
        { model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH, rig: true, confirmCost: true },
        deps
      )
    ).rejects.toThrow(
      /web variant: sharp is not installed.*hero\.glb.*rig completed and was saved/s
    );

    // The rig ran and was saved even though the package could not be written.
    expect(deps.writeFile).toHaveBeenCalledWith(RIGGED_OUT_PATH, GLB_BYTES);
    const manifest = lastWrittenManifest(deps);
    expect(manifest.rigging).toBeDefined();
    expect(manifest.package).toBeUndefined();
  });

  it('keeps the mesh and names the rig endpoint when the rigging call fails', async () => {
    const deps = createRigDeps(RIGGING_FIXTURE, {
      falSubscribe: vi
        .fn()
        .mockResolvedValueOnce({ requestId: 'req-123', data: MESHY_FIXTURE })
        .mockRejectedValueOnce(new Error('rig queue exploded')),
    });

    await expect(
      generate3d(
        { model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH, rig: true, confirmCost: true },
        deps
      )
    ).rejects.toThrow(/Rigging failed \(fal-ai\/meshy\/rigging\).*rig queue exploded.*hero\.glb/);

    // Packaging runs before rigging, so the master and the package survive.
    expect(deps.writeFile).toHaveBeenCalledWith(OUT_PATH, GLB_BYTES);
    expect(deps.writeFile).toHaveBeenCalledWith(ZIP_PATH, ZIP_BYTES, EXCLUSIVE);
    expect(deps.writeJson).toHaveBeenCalledTimes(2);
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
        confirmCost: true,
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
          confirmCost: true,
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
          confirmCost: true,
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

  it('shows the package and preview paths in the dry-run plan', async () => {
    const plan = await planGenerate3d(
      { model: MESHY_TEXT, prompt: 'a knight', out: OUT_PATH },
      createDeps()
    );
    const text = formatGenerate3dPlan(plan);

    expect(text).toContain(`Package ${ZIP_PATH}`);
    expect(text).toContain(`Preview ${HTML_PATH}`);
  });

  it('merges --input over a known model defaults', async () => {
    const deps = createDeps();
    const plan = await planGenerate3d(
      {
        model: TRELLIS_2,
        inputImage: 'https://example.test/hero.png',
        out: OUT_PATH,
        extraInput: { resolution: 512, seed: 7 },
      },
      deps
    );

    expect(plan.input).toEqual({
      image_url: 'https://example.test/hero.png',
      resolution: 512,
      seed: 7,
    });
    expect(formatGenerate3dPlan(plan)).toContain('"seed": 7');
  });

  it('plans an unknown model with no capability data and no price', async () => {
    const deps = createDeps();
    const plan = await planGenerate3d(
      { model: 'fal-ai/some-future-model', prompt: 'a knight', out: OUT_PATH },
      deps
    );
    const text = formatGenerate3dPlan(plan);

    expect(plan.costLines).toEqual([]);
    expect(plan.input).toEqual({ prompt: 'a knight' });
    expect(text).toContain('No capability data; flags are passed through and fal validates them.');
    expect(text).toContain('Cost unknown: no list price for fal-ai/some-future-model.');
    expect(text).toContain('Model fal-ai/some-future-model (input unknown, licence: unknown)');
    expect(text).toContain('No upload or fal generation call was made.');
    expect(deps.falSubscribe).not.toHaveBeenCalled();
    expect(deps.uploadFile).not.toHaveBeenCalled();
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
