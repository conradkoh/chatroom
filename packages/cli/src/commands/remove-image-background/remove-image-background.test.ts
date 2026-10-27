/**
 * remove-image-background orchestration tests with injected deps.
 *
 * The real pngjs adapter is exercised in remove-image-background-deps.test.ts and the
 * CLI end-to-end test; these tests pin validation, naming, preflight, ordering,
 * warnings, and all-or-nothing behaviour without touching disk.
 */

import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { RemoveImageBackgroundDeps } from './remove-image-background-deps.js';
import {
  RemoveBackgroundError,
  removeImageBackground,
  type RemoveBackgroundOptions,
} from './remove-image-background.js';
import type { InputStat } from '../slice-image/slice-deps.js';

vi.mock('@fal-ai/client', () => {
  throw new Error('must not load fal');
});

interface TestImage {
  width: number;
  height: number;
  data: Uint8Array;
}

const RED: [number, number, number, number] = [200, 40, 40, 255];
const BG: [number, number, number, number] = [220, 220, 220, 255];

function solidTile(width = 8, height = 8, background = BG, item = RED): TestImage {
  const data = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) data.set(background, offset);
  const x0 = Math.floor(width / 4);
  const y0 = Math.floor(height / 4);
  for (let y = y0; y < height - y0; y += 1) {
    for (let x = x0; x < width - x0; x += 1) data.set(item, (y * width + x) * 4);
  }
  return { width, height, data };
}

function blankTile(width = 8, height = 8): TestImage {
  return solidTile(width, height, BG, BG);
}

/** Minimal PNG with a valid IHDR header. */
function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8;
  bytes[25] = 6;
  return bytes;
}

function fakeEncode(image: TestImage): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      width: image.width,
      height: image.height,
      first: Array.from(image.data.subarray(0, 4)),
      last: Array.from(image.data.subarray(image.data.length - 4)),
    })
  );
}

interface FakeFile {
  kind?: InputStat['kind'];
  size?: number;
  bytes?: Uint8Array;
  image?: TestImage;
  json?: unknown;
  jsonError?: Error;
}

function createDeps(
  files: Record<string, FakeFile> = {},
  overrides: Partial<RemoveImageBackgroundDeps> = {}
): RemoveImageBackgroundDeps {
  const images = new Map<Uint8Array, TestImage>();
  const statInput = vi.fn(async (path: string): Promise<InputStat> => {
    const file = files[path];
    if (file === undefined || file.kind === 'missing') return { kind: 'missing', size: 0 };
    return { kind: file.kind ?? 'file', size: file.size ?? file.bytes?.byteLength ?? 0 };
  });
  const readFile = vi.fn(async (path: string): Promise<Uint8Array> => {
    const file = files[path];
    const bytes = file?.bytes ?? pngBytes(file?.image?.width ?? 8, file?.image?.height ?? 8);
    if (file?.image) images.set(bytes, file.image);
    return bytes;
  });
  return {
    pathStatus: vi.fn(async (path: string) => {
      const file = files[path];
      if (file === undefined) return 'missing' as const;
      return file.kind === 'directory' ? ('directory' as const) : ('file' as const);
    }),
    statInput,
    readFile,
    readJsonIfExists: vi.fn(async (path: string) => {
      const file = files[path];
      if (file?.jsonError) throw file.jsonError;
      return file?.json;
    }),
    decodePng: vi.fn((bytes: Uint8Array) => {
      const image = images.get(bytes);
      if (!image) throw new Error('no fake image');
      return image;
    }),
    encodePng: vi.fn(fakeEncode),
    ensureDir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    writeJson: vi.fn().mockResolvedValue(undefined),
    fileIdentity: vi.fn().mockResolvedValue(null),
    isSymlink: vi.fn().mockResolvedValue(false),
    now: () => new Date('2026-01-02T03:04:05.000Z'),
    decoderVersion: '6.0.0',
    listDir: vi.fn().mockResolvedValue([]),
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

const A = resolve('/tiles/a.png');
const B = resolve('/tiles/b.png');
const OUT = resolve('/out');

function dirOptions(overrides: Partial<RemoveBackgroundOptions> = {}): RemoveBackgroundOptions {
  return { inDir: resolve('/tiles'), outDir: OUT, ...overrides };
}

function singleOptions(overrides: Partial<RemoveBackgroundOptions> = {}): RemoveBackgroundOptions {
  return { in: A, out: resolve('/out/a.png'), ...overrides };
}

function tileFile(image: TestImage = solidTile(), json?: unknown): FakeFile {
  return { bytes: pngBytes(image.width, image.height), image, json };
}

function manifestFor(name: string, sheetSha = 'sheet-sha') {
  return {
    tool: 'chatroom slice-image',
    grid: { index: 0, row: 0, col: 0 },
    crop: { x: 0, y: 0, width: 8, height: 8 },
    output: { sha256: `sha-${name}` },
    source: { path: '/sheet.png', sha256: sheetSha, width: 32, height: 8 },
  };
}

describe('removeImageBackground', () => {
  it('requires exactly one input mode', async () => {
    const deps = createDeps();
    await expect(captureError(removeImageBackground({}, deps))).resolves.toBeInstanceOf(
      RemoveBackgroundError
    );
    await expect(
      captureError(removeImageBackground({ in: A, out: resolve('/out/a.png'), outDir: OUT }, deps))
    ).resolves.toBeInstanceOf(RemoveBackgroundError);
    await expect(captureError(removeImageBackground({ in: A }, deps))).resolves.toBeInstanceOf(
      RemoveBackgroundError
    );
    await expect(
      captureError(removeImageBackground({ inDir: resolve('/tiles') }, deps))
    ).resolves.toBeInstanceOf(RemoveBackgroundError);
    expect(deps.ensureDir).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('rejects --map in single mode and a non-PNG --out', async () => {
    const deps = createDeps({ [A]: tileFile() });
    await expect(
      captureError(removeImageBackground({ ...singleOptions(), map: { a: 'x' } }, deps))
    ).resolves.toBeInstanceOf(RemoveBackgroundError);
    await expect(
      captureError(removeImageBackground({ in: A, out: resolve('/out/a.jpg') }, deps))
    ).resolves.toBeInstanceOf(RemoveBackgroundError);
  });

  it('rejects out-of-range tolerance and min-area', async () => {
    const deps = createDeps({ [A]: tileFile() });
    await expect(
      captureError(removeImageBackground(singleOptions({ tolerance: 0 }), deps))
    ).resolves.toBeInstanceOf(RemoveBackgroundError);
    await expect(
      captureError(removeImageBackground(singleOptions({ tolerance: 129 }), deps))
    ).resolves.toBeInstanceOf(RemoveBackgroundError);
    await expect(
      captureError(removeImageBackground(singleOptions({ minArea: 51 }), deps))
    ).resolves.toBeInstanceOf(RemoveBackgroundError);
  });

  it('ignores non-PNG entries and counts them', async () => {
    const deps = createDeps(
      { [A]: tileFile(), [B]: tileFile() },
      { listDir: vi.fn().mockResolvedValue(['a.png', 'b.png', 'notes.txt', 'folder']) }
    );

    const result = await removeImageBackground(dirOptions(), deps);

    expect(result.ignoredNonPng).toBe(2);
    expect(result.assets).toHaveLength(2);
  });

  it('refuses an empty directory and more than 64 PNG files', async () => {
    const empty = createDeps({}, { listDir: vi.fn().mockResolvedValue([]) });
    await expect(captureError(removeImageBackground(dirOptions(), empty))).resolves.toBeInstanceOf(
      RemoveBackgroundError
    );
    const many = createDeps(
      {},
      {
        listDir: vi.fn().mockResolvedValue(Array.from({ length: 65 }, (_, i) => `${i}.png`)),
      }
    );
    await expect(captureError(removeImageBackground(dirOptions(), many))).resolves.toBeInstanceOf(
      RemoveBackgroundError
    );
    expect(many.ensureDir).not.toHaveBeenCalled();
  });

  it('refuses an unsafe stem without a map entry and an unknown map key', async () => {
    const unsafe = resolve('/tiles/bad name.png');
    const deps = createDeps(
      { [unsafe]: tileFile() },
      { listDir: vi.fn().mockResolvedValue(['bad name.png']) }
    );
    const unsafeError = await captureError(removeImageBackground(dirOptions(), deps));
    expect(unsafeError.message).toContain('bad name');

    const unknown = createDeps(
      { [A]: tileFile() },
      { listDir: vi.fn().mockResolvedValue(['a.png']) }
    );
    const unknownError = await captureError(
      removeImageBackground(dirOptions({ map: { missing: 'x' } }), unknown)
    );
    expect(unknownError.message).toContain('missing');
    expect(unknownError.message).toContain('Valid stems: a');
  });

  it('refuses duplicate and invalid assigned names', async () => {
    const deps = createDeps(
      { [A]: tileFile(), [B]: tileFile() },
      { listDir: vi.fn().mockResolvedValue(['a.png', 'b.png']) }
    );
    const duplicate = await captureError(
      removeImageBackground(dirOptions({ map: { a: 'same', b: 'SAME' } }), deps)
    );
    expect(duplicate.message).toContain('Duplicate output name');
    const invalid = await captureError(
      removeImageBackground(dirOptions({ map: { a: 'bad.name' } }), deps)
    );
    expect(invalid.message).toContain('not a safe file name');
  });

  it('writes a manifest with the full source chain and naming', async () => {
    const deps = createDeps({
      [A]: tileFile(solidTile(), manifestFor('a', 'sheet-hash')),
      [`${A}.json`]: { json: manifestFor('a', 'sheet-hash') },
    });

    const result = await removeImageBackground(singleOptions(), deps);

    expect(result.dryRun).toBe(false);
    const encoded = (deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Uint8Array;
    const manifest = (deps.writeJson as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(manifest).toEqual({
      tool: 'chatroom remove-image-background',
      decoder: 'pngjs@6.0.0',
      source: {
        path: A,
        sha256: createHash('sha256').update(pngBytes(8, 8)).digest('hex'),
        bytes: pngBytes(8, 8).byteLength,
        width: 8,
        height: 8,
        manifestPath: `${A}.json`,
        manifest: {
          tool: 'chatroom slice-image',
          gridIndex: 0,
          row: 0,
          col: 0,
          crop: { x: 0, y: 0, width: 8, height: 8 },
          outputSha256: 'sha-a',
          sha256Matches: false,
          sheet: { path: '/sheet.png', sha256: 'sheet-hash', width: 32, height: 8 },
        },
      },
      naming: { sourceStem: 'a', assignedName: 'a', assignedBy: 'out' },
      keying: {
        method: 'border-flood-fill',
        background: [220, 220, 220],
        tolerance: 24,
        minAreaPercent: 0.5,
        feather: 'linear-T-to-2T',
        floodConnectivity: 4,
        componentConnectivity: 8,
      },
      result: {
        components: 1,
        foregroundPixels: 16,
        foregroundRatio: 0.25,
        droppedSpecks: { count: 0, pixels: 0 },
        enclosedBackgroundLike: 0,
        contentBox: { x: 2, y: 2, width: 4, height: 4 },
        centerOffset: { x: 0, y: 0 },
        touchesTileEdge: false,
      },
      output: {
        path: resolve('/out/a.png'),
        sha256: createHash('sha256').update(encoded).digest('hex'),
        contentType: 'image/png',
        bytes: encoded.byteLength,
        width: 8,
        height: 8,
        hasAlpha: true,
      },
      trim: null,
      isolatedAt: '2026-01-02T03:04:05.000Z',
      licensing: 'unverified',
    });
    expect(result.assets[0]?.assignedName).toBe('a');
    expect(result.assets[0]?.sha256).toBe(createHash('sha256').update(encoded).digest('hex'));
  });

  it('warns but succeeds when the sidecar is absent, invalid, oversize, or mismatched', async () => {
    const absent = createDeps({ [A]: tileFile() });
    const absentResult = await removeImageBackground(singleOptions(), absent);
    expect(absentResult.assets[0]?.warnings.join(' ')).toContain('No tile manifest');

    const invalid = createDeps({
      [A]: tileFile(),
      [`${A}.json`]: { jsonError: new Error('Unexpected token <') },
    });
    const invalidResult = await removeImageBackground(singleOptions(), invalid);
    expect(invalidResult.assets[0]?.warnings.join(' ')).toContain('Unexpected token');

    const oversize = createDeps({
      [A]: tileFile(),
      [`${A}.json`]: { size: 2 * 1024 * 1024 },
    });
    const oversizeResult = await removeImageBackground(singleOptions(), oversize);
    expect(oversizeResult.assets[0]?.warnings.join(' ')).toContain('sidecar limit');

    const mismatch = createDeps({ [A]: tileFile() });
    filesJson(mismatch, `${A}.json`, manifestFor('a', 'sheet-hash'));
    const mismatchResult = await removeImageBackground(singleOptions(), mismatch);
    expect(mismatchResult.assets[0]?.warnings.join(' ')).toContain('does not match the tile');

    for (const deps of [absent, invalid, oversize, mismatch]) {
      expect(deps.writeFile).toHaveBeenCalled();
    }
  });

  it('refuses existing outputs, directories, and symlinks with zero writes', async () => {
    const deps = createDeps({ [A]: tileFile() });
    deps.pathStatus = vi.fn(async (path: string) => {
      if (path === resolve('/out/a.png')) return 'file';
      if (path === resolve('/out/a.png.json')) return 'directory';
      return 'missing';
    });
    deps.isSymlink = vi.fn(async (path: string) => path === resolve('/out/a.png'));

    const error = await captureError(removeImageBackground(singleOptions(), deps));

    expect(error.message).toContain('Refusing to write');
    expect(error.message).toContain('this is a symbolic link');
    expect(error.message).toContain('a directory is in the way');
    expect(deps.ensureDir).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('refuses an output equal to the input or its sidecar even with force', async () => {
    const deps = createDeps(
      { [A]: tileFile(), [`${A}.json`]: tileFile() },
      { listDir: vi.fn().mockResolvedValue(['a.png']) }
    );
    deps.fileIdentity = vi.fn(async (path: string) => (path === A ? { dev: 1, ino: 2 } : null));

    const error = await captureError(
      removeImageBackground(
        dirOptions({ inDir: resolve('/tiles'), outDir: resolve('/tiles'), force: true }),
        deps
      )
    );

    expect(error.message).toContain('source sheet or its manifest');
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('refuses the aggregate pixel budget before decoding any tile', async () => {
    const deps = createDeps(
      {
        [A]: { bytes: pngBytes(8000, 8000), image: solidTile() },
        [B]: { bytes: pngBytes(8000, 8000), image: solidTile() },
      },
      { listDir: vi.fn().mockResolvedValue(['a.png', 'b.png']) }
    );

    const error = await captureError(removeImageBackground(dirOptions(), deps));

    expect(error.message).toContain('Inputs total 128000000 pixels');
    expect(deps.decodePng).not.toHaveBeenCalled();
    expect(deps.ensureDir).not.toHaveBeenCalled();
  });

  it('aborts before any write when a later tile cannot be keyed', async () => {
    const deps = createDeps(
      { [A]: tileFile(), [B]: { ...tileFile(blankTile()), image: blankTile() } },
      { listDir: vi.fn().mockResolvedValue(['a.png', 'b.png']) }
    );

    const error = await captureError(removeImageBackground(dirOptions(), deps));

    expect(error.message).toContain('b.png');
    expect(deps.ensureDir).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.writeJson).not.toHaveBeenCalled();
  });

  it('dry run writes nothing but still refuses conflicts', async () => {
    const deps = createDeps({ [A]: tileFile() });
    const dry = await removeImageBackground(singleOptions({ dryRun: true }), deps);
    expect(dry.dryRun).toBe(true);
    expect(deps.ensureDir).not.toHaveBeenCalled();

    const conflicts = createDeps({ [A]: tileFile() });
    conflicts.pathStatus = vi.fn(async (path: string) =>
      path === resolve('/out/a.png') ? 'file' : 'missing'
    );
    const error = await captureError(
      removeImageBackground(singleOptions({ dryRun: true }), conflicts)
    );
    expect(error.message).toContain('already exists');
    expect(conflicts.writeFile).not.toHaveBeenCalled();
  });

  it('writes PNG then manifest per asset with exclusive writes unless forced', async () => {
    const deps = createDeps(
      { [A]: tileFile(), [B]: tileFile() },
      { listDir: vi.fn().mockResolvedValue(['a.png', 'b.png']) }
    );

    await removeImageBackground(dirOptions(), deps);

    const calls = (deps.writeFile as ReturnType<typeof vi.fn>).mock.invocationCallOrder;
    const jsonCalls = (deps.writeJson as ReturnType<typeof vi.fn>).mock.invocationCallOrder;
    expect(calls[0]).toBeLessThan(jsonCalls[0] as number);
    expect(jsonCalls[0]).toBeLessThan(calls[1] as number);
    expect(deps.writeFile).toHaveBeenCalledWith(resolve('/out/a.png'), expect.any(Uint8Array), {
      exclusive: true,
    });
    expect(deps.writeJson).toHaveBeenCalledWith(resolve('/out/a.png.json'), expect.anything(), {
      exclusive: true,
    });

    const forced = createDeps(
      { [A]: tileFile() },
      { listDir: vi.fn().mockResolvedValue(['a.png']) }
    );
    await removeImageBackground(dirOptions({ force: true }), forced);
    expect(forced.writeFile).toHaveBeenCalledWith(resolve('/out/a.png'), expect.any(Uint8Array), {
      exclusive: false,
    });
  });

  it('names already-written files on a partial write failure', async () => {
    const deps = createDeps(
      { [A]: tileFile(), [B]: tileFile() },
      { listDir: vi.fn().mockResolvedValue(['a.png', 'b.png']) }
    );
    deps.writeFile = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('disk full'));

    const error = await captureError(removeImageBackground(dirOptions(), deps));

    expect(error.message).toContain(`Failed to write ${resolve('/out/b.png')}`);
    expect(error.message).toContain('disk full');
    expect(error.message).toContain(resolve('/out/a.png'));
    expect(error.message).toContain(resolve('/out/a.png.json'));
  });

  it('trims to the content box and reports the cropped size and trim metadata', async () => {
    const deps = createDeps({ [A]: tileFile() });

    const result = await removeImageBackground(singleOptions({ trim: true }), deps);

    const encoded = (deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Uint8Array;
    const manifest = (deps.writeJson as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(result.assets[0]).toMatchObject({ trimmed: true, width: 4, height: 4 });
    expect(manifest.output).toMatchObject({ width: 4, height: 4 });
    expect(manifest.trim).toEqual({
      padding: 0,
      rect: { x: 2, y: 2, width: 4, height: 4 },
      sizeBefore: { width: 8, height: 8 },
      sizeAfter: { width: 4, height: 4 },
    });
    expect(manifest.output).toMatchObject({
      sha256: createHash('sha256').update(encoded).digest('hex'),
      bytes: encoded.byteLength,
    });
  });

  it('applies trim padding and keeps the pre-crop content box and centre offset', async () => {
    const deps = createDeps({ [A]: tileFile() });

    const result = await removeImageBackground(singleOptions({ trim: true, trimPadding: 2 }), deps);

    const manifest = (deps.writeJson as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
      trim: Record<string, unknown>;
      result: { contentBox: Record<string, number>; centerOffset: Record<string, number> };
    };
    expect(result.assets[0]).toMatchObject({ trimmed: true, width: 8, height: 8 });
    expect(manifest.trim).toMatchObject({
      padding: 2,
      rect: { x: 0, y: 0, width: 8, height: 8 },
    });
    expect(manifest.result.contentBox).toEqual({ x: 2, y: 2, width: 4, height: 4 });
    expect(manifest.result.centerOffset).toEqual({ x: 0, y: 0 });
  });

  it('refuses trimPadding without trim', async () => {
    const deps = createDeps({ [A]: tileFile() });

    const error = await captureError(
      removeImageBackground(singleOptions({ trimPadding: 2 }), deps)
    );

    expect(error.message).toContain('--trim-padding is only valid with --trim');
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('dry run reports trimmed sizes without writing', async () => {
    const deps = createDeps({ [A]: tileFile() });

    const result = await removeImageBackground(
      singleOptions({ trim: true, trimPadding: 1, dryRun: true }),
      deps
    );

    expect(result.assets[0]).toMatchObject({ trimmed: true, width: 6, height: 6 });
    expect(deps.ensureDir).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('does not read prototype properties for an unmapped constructor stem', async () => {
    const constructorPath = resolve('/tiles/constructor.png');
    const deps = createDeps(
      { [constructorPath]: tileFile() },
      { listDir: vi.fn().mockResolvedValue(['constructor.png']) }
    );

    const result = await removeImageBackground(dirOptions(), deps);

    expect(result.assets[0]?.assignedName).toBe('constructor');
    const manifest = (deps.writeJson as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
      naming: { assignedBy: string };
    };
    expect(manifest.naming.assignedBy).toBe('source-stem');
  });

  it('warns when a tile has more than one region', async () => {
    const image = solidTile(10, 10);
    // Clear the middle columns so two blobs remain, each above 0.5%.
    for (let y = 0; y < 10; y += 1) {
      for (let x = 4; x < 6; x += 1) image.data.set(BG, (y * 10 + x) * 4);
    }
    const deps = createDeps({ [A]: tileFile(image) });

    const result = await removeImageBackground(singleOptions(), deps);

    expect(result.assets[0]?.components).toBe(2);
    expect(result.assets[0]?.warnings.join(' ')).toContain('2 separate regions kept');
  });
});

function filesJson(deps: RemoveImageBackgroundDeps, path: string, json: unknown): void {
  const original = deps.statInput;
  deps.statInput = vi.fn(async (target: string): Promise<InputStat> => {
    if (target === path) return { kind: 'file', size: 10 };
    return original(target);
  });
  deps.readJsonIfExists = vi.fn(async (target: string) => (target === path ? json : undefined));
}
