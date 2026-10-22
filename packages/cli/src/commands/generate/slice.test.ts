/**
 * Slice Image Unit Tests
 *
 * Exercises the pure slicing logic with injected deps only. No network, no
 * filesystem, no PNG codec, and no fal SDK import.
 */

import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { PathStatus } from './deps.js';
import type { InputStat, SliceImageDeps } from './slice-deps.js';
import {
  computeSliceGrid,
  MAX_SOURCE_BYTES,
  readPngDimensions,
  resolveTileNames,
  sliceImage,
  SliceImageError,
} from './slice.js';

// slice-image must never load the fal SDK or read FAL_API_KEY.
vi.mock('@fal-ai/client', () => {
  throw new Error('must not load fal');
});

/** Minimal PNG bytes with a valid IHDR header for the given dimensions. */
function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8; // bit depth
  bytes[25] = 6; // RGBA
  return bytes;
}

const SHEET_BYTES = pngBytes(4, 4);
const SHEET_SHA = createHash('sha256').update(SHEET_BYTES).digest('hex');
const IN_PATH = resolve('/tmp/sheets/sheet.png');
const OUT_DIR = resolve('/tmp/tiles');

/** Synthetic RGBA image: pixel (x, y) encodes its own coordinates. */
function makeImage(
  width: number,
  height: number
): {
  width: number;
  height: number;
  data: Uint8Array;
} {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set(sheetPixel(x, y), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/** The pixel value `makeImage` stores at (x, y), computed from its contract. */
function sheetPixel(x: number, y: number): number[] {
  return [x & 255, y & 255, (x >> 8) | ((y >> 8) << 4), 255];
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SOURCE_IDENTITY = { dev: 1, ino: 100 };

/** Recognisable, deterministic bytes with the crop's first and last pixel. */
function fakeEncode(image: { width: number; height: number; data: Uint8Array }): Uint8Array {
  return encoder.encode(
    JSON.stringify({
      width: image.width,
      height: image.height,
      firstPixel: Array.from(image.data.subarray(0, 4)),
      lastPixel: Array.from(image.data.subarray(image.data.length - 4)),
    })
  );
}

function createDeps(overrides: Partial<SliceImageDeps> = {}): SliceImageDeps {
  return {
    pathStatus: defaultPathStatus(),
    statInput: defaultStatInput(),
    readFile: vi.fn().mockResolvedValue(SHEET_BYTES),
    readJsonIfExists: vi.fn().mockResolvedValue(undefined),
    decodePng: vi.fn(() => makeImage(4, 4)),
    encodePng: vi.fn(fakeEncode),
    ensureDir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    writeJson: vi.fn().mockResolvedValue(undefined),
    fileIdentity: defaultFileIdentity(),
    isSymlink: vi.fn().mockResolvedValue(false),
    now: () => new Date('2026-01-02T03:04:05.000Z'),
    decoderVersion: '6.0.0',
    ...overrides,
  };
}

/** The sheet and its sidecar are regular files; every other path is missing. */
function defaultStatInput(): SliceImageDeps['statInput'] {
  return vi.fn(async (path: string): Promise<InputStat> => {
    if (path === IN_PATH) return { kind: 'file', size: SHEET_BYTES.byteLength };
    if (path === `${IN_PATH}.json`) return { kind: 'file', size: 2 };
    return { kind: 'missing', size: 0 };
  });
}

/** The sheet has an identity; every other path is missing. */
function defaultFileIdentity(): SliceImageDeps['fileIdentity'] {
  return vi.fn(async (path: string) => (path === IN_PATH ? SOURCE_IDENTITY : null));
}

/** The sheet exists; every other path is missing. */
function defaultPathStatus(): SliceImageDeps['pathStatus'] {
  return vi.fn(async (path: string) => (path === IN_PATH ? 'file' : 'missing'));
}

/** pathStatus fake backed by an explicit map; the sheet is a file and anything unlisted is missing. */
function pathStatusFor(entries: Record<string, PathStatus>): SliceImageDeps['pathStatus'] {
  return vi.fn(async (path: string) => {
    const entry = entries[path];
    if (entry !== undefined) return entry;
    return path === IN_PATH ? 'file' : 'missing';
  });
}

/** fileIdentity fake: the sheet always resolves to SOURCE_IDENTITY. */
function fileIdentityFor(
  entries: Record<string, { dev: number; ino: number } | null>
): SliceImageDeps['fileIdentity'] {
  return vi.fn(async (path: string) => {
    const entry = entries[path];
    if (entry !== undefined) return entry;
    return path === IN_PATH ? SOURCE_IDENTITY : null;
  });
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

function fileCalls(mock: unknown): string[] {
  return (mock as ReturnType<typeof vi.fn>).mock.calls.map((call) => String(call[0]));
}

describe('readPngDimensions', () => {
  it('reads width and height from IHDR', () => {
    expect(readPngDimensions(pngBytes(1024, 768))).toEqual({ width: 1024, height: 768 });
  });

  it('returns null for a truncated header', () => {
    expect(readPngDimensions(pngBytes(4, 4).subarray(0, 23))).toBeNull();
  });

  it('returns null when the first chunk is not IHDR', () => {
    const bytes = pngBytes(4, 4);
    bytes[12] = 0x58;
    expect(readPngDimensions(bytes)).toBeNull();
  });
});

describe('computeSliceGrid', () => {
  it('divides 1024x768 into a 4x3 grid of 256x256 cells', () => {
    const grid = computeSliceGrid({
      width: 1024,
      height: 768,
      cols: 4,
      rows: 3,
      margin: 0,
      gutter: 0,
      allowRemainder: false,
    });

    expect(grid.tileWidth).toBe(256);
    expect(grid.tileHeight).toBe(256);
    expect(grid.cells).toHaveLength(12);
    expect(grid.cells[0]).toMatchObject({ index: 0, row: 0, col: 0, x: 0, y: 0 });
    expect(grid.cells[5]).toMatchObject({ index: 5, row: 1, col: 1, x: 256, y: 256 });
    expect(grid.cells[11]).toMatchObject({ index: 11, row: 2, col: 3, x: 768, y: 512 });
  });

  it('applies margin and gutter exactly', () => {
    const grid = computeSliceGrid({
      width: 100,
      height: 100,
      cols: 2,
      rows: 2,
      margin: 4,
      gutter: 2,
      allowRemainder: false,
    });

    expect(grid.tileWidth).toBe(45);
    expect(grid.tileHeight).toBe(45);
    expect(grid.cells[1]).toMatchObject({ x: 51, y: 4, width: 45, height: 45 });
    expect(grid.cells[2]).toMatchObject({ x: 4, y: 51 });
  });

  it('refuses a non-divisible grid with the remainder message', () => {
    expect(() =>
      computeSliceGrid({
        width: 1024,
        height: 768,
        cols: 3,
        rows: 2,
        margin: 0,
        gutter: 0,
        allowRemainder: false,
      })
    ).toThrow(
      'Sheet 1024x768 does not divide into 3 cols x 2 rows (width remainder 1px, height remainder 0px). Use a grid that divides evenly, or pass --allow-remainder to drop the leftover pixels on the right/bottom.'
    );
  });

  it('drops remainder pixels when allowRemainder is set', () => {
    const grid = computeSliceGrid({
      width: 1024,
      height: 768,
      cols: 3,
      rows: 2,
      margin: 0,
      gutter: 0,
      allowRemainder: true,
    });

    expect(grid.tileWidth).toBe(341);
    expect(grid.tileHeight).toBe(384);
    expect(grid.droppedRight).toBe(1);
    expect(grid.droppedBottom).toBe(0);
  });

  it('refuses a grid larger than the usable image', () => {
    expect(() =>
      computeSliceGrid({
        width: 3,
        height: 3,
        cols: 4,
        rows: 1,
        margin: 0,
        gutter: 0,
        allowRemainder: true,
      })
    ).toThrow(/grid does not fit/);
  });

  it('lays cells out row-major', () => {
    const grid = computeSliceGrid({
      width: 6,
      height: 6,
      cols: 3,
      rows: 2,
      margin: 0,
      gutter: 0,
      allowRemainder: false,
    });

    expect(grid.cells.map((cell) => [cell.index, cell.row, cell.col, cell.x, cell.y])).toEqual([
      [0, 0, 0, 0, 0],
      [1, 0, 1, 2, 0],
      [2, 0, 2, 4, 0],
      [3, 1, 0, 0, 3],
      [4, 1, 1, 2, 3],
      [5, 1, 2, 4, 3],
    ]);
  });
});

describe('resolveTileNames', () => {
  it('defaults to a zero-padded prefix with two digits', () => {
    expect(resolveTileNames({ cols: 4, rows: 3, prefix: 'sheet' })).toEqual([
      'sheet-01',
      'sheet-02',
      'sheet-03',
      'sheet-04',
      'sheet-05',
      'sheet-06',
      'sheet-07',
      'sheet-08',
      'sheet-09',
      'sheet-10',
      'sheet-11',
      'sheet-12',
    ]);
  });

  it('widens padding past 99 tiles', () => {
    const names = resolveTileNames({ cols: 20, rows: 5, prefix: 'sheet' });
    expect(names).toHaveLength(100);
    expect(names[0]).toBe('sheet-001');
    expect(names[99]).toBe('sheet-100');
  });

  it('requires exactly cols*rows explicit names', () => {
    expect(() => resolveTileNames({ cols: 2, rows: 2, names: ['a', 'b'], prefix: 'x' })).toThrow(
      '--names must have exactly 4 entries for a 2x2 grid (got 2).'
    );
  });

  it.each(['../x', 'a/b', 'a.png', 'a b', 'a:b'])('refuses the unsafe name %s', (name) => {
    expect(() => resolveTileNames({ cols: 2, rows: 1, names: [name, 'ok'], prefix: 'x' })).toThrow(
      /not a safe file name/
    );
  });

  it('refuses case-insensitive duplicates', () => {
    expect(() =>
      resolveTileNames({ cols: 2, rows: 1, names: ['Hero', 'hero'], prefix: 'x' })
    ).toThrow('duplicate "hero"');
  });

  it('treats an empty entry as a skipped cell', () => {
    expect(resolveTileNames({ cols: 2, rows: 2, names: ['a', '', 'c', 'd'], prefix: 'x' })).toEqual(
      ['a', '', 'c', 'd']
    );
  });

  it('refuses an all-empty name list', () => {
    expect(() => resolveTileNames({ cols: 2, rows: 1, names: ['', '  '], prefix: 'x' })).toThrow(
      'at least one non-empty name'
    );
  });

  it('sanitises the prefix', () => {
    expect(resolveTileNames({ cols: 1, rows: 2, prefix: 'my sheet.png' })).toEqual([
      'my-sheet-png-01',
      'my-sheet-png-02',
    ]);
  });

  it('refuses a prefix with nothing safe left', () => {
    expect(() => resolveTileNames({ cols: 1, rows: 1, prefix: '...' })).toThrow(/--prefix/);
  });

  it('refuses a prefix whose output names exceed the length limit', () => {
    expect(() => resolveTileNames({ cols: 1, rows: 1, prefix: 'a'.repeat(300) })).toThrow(
      /Output name .* is 315 characters; the maximum is 200/
    );
  });
});

describe('sliceImage', () => {
  const opts = {
    in: IN_PATH,
    outDir: OUT_DIR,
    cols: 2,
    rows: 2,
    names: ['hero', '', 'goblin', 'orc'],
  };

  it('writes each tile png and manifest in index order, then the index last', async () => {
    const deps = createDeps();

    const result = await sliceImage(opts, deps);

    expect(result.dryRun).toBe(false);
    expect(result.sheet).toEqual({
      path: IN_PATH,
      sha256: SHEET_SHA,
      width: 4,
      height: 4,
    });
    expect(result.tileSize).toEqual({ width: 2, height: 2 });
    expect(result.droppedRemainder).toEqual({ right: 0, bottom: 0 });
    expect(result.skipped).toEqual([1]);
    expect(result.tiles.map((tile) => tile.name)).toEqual(['hero', 'goblin', 'orc']);
    expect(result.indexPath).toBe(resolve('/tmp/tiles/sheet.slices.json'));

    const pngCalls = fileCalls(deps.writeFile);
    const jsonCalls = fileCalls(deps.writeJson);
    expect(pngCalls).toEqual([
      resolve('/tmp/tiles/hero.png'),
      resolve('/tmp/tiles/goblin.png'),
      resolve('/tmp/tiles/orc.png'),
    ]);
    expect(jsonCalls).toEqual([
      resolve('/tmp/tiles/hero.png.json'),
      resolve('/tmp/tiles/goblin.png.json'),
      resolve('/tmp/tiles/orc.png.json'),
      resolve('/tmp/tiles/sheet.slices.json'),
    ]);

    const order = (deps.writeFile as ReturnType<typeof vi.fn>).mock.invocationCallOrder;
    const jsonOrder = (deps.writeJson as ReturnType<typeof vi.fn>).mock.invocationCallOrder;
    expect(order[0]).toBeLessThan(jsonOrder[0] as number);
    expect(jsonOrder[0]).toBeLessThan(order[1] as number);
    expect(jsonOrder[2]).toBeLessThan(jsonOrder[3] as number);
  });

  it('creates the output directory once, before the first write', async () => {
    const deps = createDeps();

    await sliceImage(opts, deps);

    expect(deps.ensureDir).toHaveBeenCalledTimes(1);
    expect(deps.ensureDir).toHaveBeenCalledWith(OUT_DIR);
    const ensureOrder = (deps.ensureDir as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const writeOrder = (deps.writeFile as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(ensureOrder).toBeLessThan(writeOrder as number);
  });

  it('writes an exact per-tile manifest with real geometry and hashes', async () => {
    const deps = createDeps();

    await sliceImage(opts, deps);

    const second = (deps.writeJson as ReturnType<typeof vi.fn>).mock.calls[1]?.[1] as Record<
      string,
      unknown
    >;
    const goblinBytes = (deps.writeFile as ReturnType<typeof vi.fn>).mock
      .calls[1]?.[1] as Uint8Array;
    expect(second).toEqual({
      tool: 'chatroom slice-image',
      decoder: 'pngjs@6.0.0',
      source: {
        path: IN_PATH,
        sha256: SHEET_SHA,
        bytes: SHEET_BYTES.byteLength,
        width: 4,
        height: 4,
        manifestPath: null,
        manifest: null,
      },
      grid: { cols: 2, rows: 2, margin: 0, gutter: 0, row: 1, col: 0, index: 2 },
      crop: { x: 0, y: 2, width: 2, height: 2 },
      output: {
        path: resolve('/tmp/tiles/goblin.png'),
        sha256: createHash('sha256')
          .update(
            fakeEncode({
              width: 2,
              height: 2,
              // Row 1, col 0 of makeImage(4, 4), read from the pixel contract.
              data: Uint8Array.from([
                ...sheetPixel(0, 2),
                ...sheetPixel(1, 2),
                ...sheetPixel(0, 3),
                ...sheetPixel(1, 3),
              ]),
            })
          )
          .digest('hex'),
        contentType: 'image/png',
        bytes: goblinBytes.byteLength,
        width: 2,
        height: 2,
        hasAlpha: false,
      },
      slicedAt: '2026-01-02T03:04:05.000Z',
      licensing: 'unverified',
    });
  });

  it('crops pixels exactly, without resampling', async () => {
    const deps = createDeps();

    await sliceImage(opts, deps);

    const heroBytes = (deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Uint8Array;
    const hero = JSON.parse(decoder.decode(heroBytes)) as {
      firstPixel: number[];
      lastPixel: number[];
    };
    // Tile (row 0, col 0): pixels (0,0) through (1,1).
    expect(hero.firstPixel).toEqual([0, 0, 0, 255]);
    expect(hero.lastPixel).toEqual([1, 1, 0, 255]);

    const orcBytes = (deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[2]?.[1] as Uint8Array;
    const orc = JSON.parse(decoder.decode(orcBytes)) as {
      firstPixel: number[];
      lastPixel: number[];
    };
    expect(orc.firstPixel).toEqual([2, 2, 0, 255]);
    expect(orc.lastPixel).toEqual([3, 3, 0, 255]);
  });

  it('preserves alpha and reports hasAlpha', async () => {
    const image = makeImage(4, 4);
    // Make the top-left pixel fully transparent.
    image.data[3] = 0;
    const deps = createDeps({ decodePng: vi.fn(() => image) });

    await sliceImage(opts, deps);

    const manifest = (deps.writeJson as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
      output: { hasAlpha: boolean };
    };
    expect(manifest.output.hasAlpha).toBe(true);
    const bytes = (deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Uint8Array;
    const decoded = JSON.parse(decoder.decode(bytes)) as { firstPixel: number[] };
    expect(decoded.firstPixel).toEqual([0, 0, 0, 0]);
  });

  describe('source manifest', () => {
    const generateImageManifest = {
      platform: 'fal',
      model: 'fal-ai/flux-2/flash',
      requestId: 'req-123',
      seed: 42,
      generatedAt: '2026-01-01T00:00:00.000Z',
      output: { sha256: SHEET_SHA },
    };

    it('warns when the sidecar is absent', async () => {
      const deps = createDeps();

      const result = await sliceImage(opts, deps);

      expect(result.warnings).toContain(
        `No generate-image manifest at ${IN_PATH}.json; tile manifests record the sheet hash only.`
      );
      const manifest = (deps.writeJson as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<
        string,
        unknown
      >;
      expect(manifest.source).toMatchObject({ manifestPath: null, manifest: null });
    });

    it('warns and continues when the sidecar is unparseable', async () => {
      const deps = createDeps({
        readJsonIfExists: vi.fn().mockRejectedValue(new Error('Unexpected token <')),
      });

      const result = await sliceImage(opts, deps);

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings.some((warning) => warning.includes('Ignoring'))).toBe(true);
      expect(result.tiles).toHaveLength(3);
    });

    it('ignores an oversized sidecar without reading it', async () => {
      const readJsonIfExists = vi.fn().mockResolvedValue(generateImageManifest);
      const deps = createDeps({
        readJsonIfExists,
        statInput: vi.fn(async (path: string): Promise<InputStat> => {
          if (path === IN_PATH) return { kind: 'file', size: SHEET_BYTES.byteLength };
          if (path === `${IN_PATH}.json`) return { kind: 'file', size: 1024 * 1024 + 1 };
          return { kind: 'missing', size: 0 };
        }),
      });

      const result = await sliceImage(opts, deps);

      expect(readJsonIfExists).not.toHaveBeenCalled();
      expect(result.warnings.some((warning) => warning.includes('sidecar limit'))).toBe(true);
      expect(result.tiles).toHaveLength(3);
    });

    it('ignores a sidecar that is not a regular file', async () => {
      const readJsonIfExists = vi.fn().mockResolvedValue(generateImageManifest);
      const deps = createDeps({
        readJsonIfExists,
        statInput: vi.fn(async (path: string): Promise<InputStat> => {
          if (path === IN_PATH) return { kind: 'file', size: SHEET_BYTES.byteLength };
          if (path === `${IN_PATH}.json`) return { kind: 'other', size: 0 };
          return { kind: 'missing', size: 0 };
        }),
      });

      const result = await sliceImage(opts, deps);

      expect(readJsonIfExists).not.toHaveBeenCalled();
      expect(result.warnings.some((warning) => warning.includes('not a regular file'))).toBe(true);
    });

    it('copies provenance and records a matching hash', async () => {
      const deps = createDeps({
        readJsonIfExists: vi.fn().mockResolvedValue(generateImageManifest),
      });

      await sliceImage(opts, deps);

      const manifest = (deps.writeJson as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
        source: Record<string, unknown>;
      };
      expect(manifest.source).toMatchObject({
        manifestPath: `${IN_PATH}.json`,
        manifest: {
          platform: 'fal',
          model: 'fal-ai/flux-2/flash',
          requestId: 'req-123',
          seed: 42,
          generatedAt: '2026-01-01T00:00:00.000Z',
          outputSha256: SHEET_SHA,
          sha256Matches: true,
        },
      });
    });

    it('records a mismatch with a warning and still succeeds', async () => {
      const deps = createDeps({
        readJsonIfExists: vi.fn().mockResolvedValue({
          ...generateImageManifest,
          output: { sha256: 'not-the-sheet' },
        }),
      });

      const result = await sliceImage(opts, deps);

      expect(result.tiles).toHaveLength(3);
      expect(result.warnings.some((warning) => warning.includes('does not match'))).toBe(true);
      const manifest = (deps.writeJson as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
        source: { manifest: { sha256Matches: boolean } };
      };
      expect(manifest.source.manifest.sha256Matches).toBe(false);
    });
  });

  describe('refusals write nothing', () => {
    function expectNothingWritten(deps: SliceImageDeps): void {
      expect(deps.ensureDir).not.toHaveBeenCalled();
      expect(deps.writeFile).not.toHaveBeenCalled();
      expect(deps.writeJson).not.toHaveBeenCalled();
    }

    it('refuses a missing --in', async () => {
      const deps = createDeps({
        statInput: vi.fn().mockResolvedValue({ kind: 'missing', size: 0 } satisfies InputStat),
      });

      const error = await captureError(sliceImage(opts, deps));

      expect(error).toBeInstanceOf(SliceImageError);
      expect(error.message).toBe(`--in not found: ${IN_PATH}`);
      expectNothingWritten(deps);
      expect(deps.readFile).not.toHaveBeenCalled();
    });

    it('refuses a directory --in', async () => {
      const deps = createDeps({
        statInput: vi.fn().mockResolvedValue({ kind: 'directory', size: 0 } satisfies InputStat),
      });

      const error = await captureError(sliceImage(opts, deps));

      expect(error.message).toContain('--in is a directory');
      expectNothingWritten(deps);
      expect(deps.readFile).not.toHaveBeenCalled();
    });

    it('refuses a non-regular --in without reading it', async () => {
      const deps = createDeps({
        statInput: vi.fn().mockResolvedValue({ kind: 'other', size: 0 } satisfies InputStat),
      });

      const error = await captureError(sliceImage(opts, deps));

      expect(error.message).toContain('--in is not a regular file');
      expect(deps.readFile).not.toHaveBeenCalled();
      expectNothingWritten(deps);
    });

    it('refuses an oversized --in before reading it', async () => {
      const deps = createDeps({
        statInput: vi
          .fn()
          .mockResolvedValue({ kind: 'file', size: MAX_SOURCE_BYTES + 1 } satisfies InputStat),
      });

      const error = await captureError(sliceImage(opts, deps));

      expect(error.message).toContain('maximum is 67108864 bytes');
      expect(deps.readFile).not.toHaveBeenCalled();
      expectNothingWritten(deps);
    });

    it('refuses non-PNG bytes', async () => {
      const deps = createDeps({
        readFile: vi.fn().mockResolvedValue(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])),
      });

      const error = await captureError(sliceImage(opts, deps));

      expect(error.message).toContain('--in is not a PNG');
      expectNothingWritten(deps);
      expect(deps.decodePng).not.toHaveBeenCalled();
    });

    it('refuses an oversized sheet from IHDR before decoding', async () => {
      const deps = createDeps({
        readFile: vi.fn().mockResolvedValue(pngBytes(30_000, 30_000)),
        decodePng: vi.fn(() => {
          throw new Error('decode must not run');
        }),
      });

      const error = await captureError(sliceImage(opts, deps));

      expect(error.message).toContain('900000000 pixels');
      expect(error.message).toContain('maximum is 100000000 pixels');
      expect(deps.decodePng).not.toHaveBeenCalled();
      expectNothingWritten(deps);
    });

    it('refuses a truncated header without decoding', async () => {
      const truncated = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
      const deps = createDeps({
        readFile: vi.fn().mockResolvedValue(truncated),
      });

      const error = await captureError(sliceImage(opts, deps));

      expect(error.message).toBe('Could not decode --in as PNG: missing or invalid IHDR header.');
      expect(deps.decodePng).not.toHaveBeenCalled();
      expectNothingWritten(deps);
    });

    it('refuses zero dimensions without decoding', async () => {
      const deps = createDeps({ readFile: vi.fn().mockResolvedValue(pngBytes(0, 0)) });

      const error = await captureError(sliceImage(opts, deps));

      expect(error.message).toContain('invalid dimensions 0x0');
      expect(deps.decodePng).not.toHaveBeenCalled();
      expectNothingWritten(deps);
    });

    it('refuses decoded data that is not RGBA', async () => {
      const deps = createDeps({
        decodePng: vi.fn(() => ({ width: 2, height: 2, data: new Uint8Array(3) })),
      });

      const error = await captureError(sliceImage(opts, deps));

      expect(error.message).toContain('expected 16 RGBA bytes, got 3');
      expectNothingWritten(deps);
    });

    it('refuses an over-long prefix before any write', async () => {
      const deps = createDeps();

      const error = await captureError(
        sliceImage({ ...opts, names: undefined, prefix: 'a'.repeat(300) }, deps)
      );

      expect(error.message).toContain('maximum is 200');
      expectNothingWritten(deps);
    });

    it('refuses bytes larger than 64 MiB', async () => {
      const deps = createDeps({
        readFile: vi.fn().mockResolvedValue(new Uint8Array(MAX_SOURCE_BYTES + 1)),
      });

      const error = await captureError(sliceImage(opts, deps));

      expect(error.message).toContain('maximum is 67108864 bytes');
      expectNothingWritten(deps);
    });

    it('wraps a decode failure', async () => {
      const deps = createDeps({
        decodePng: vi.fn(() => {
          throw new Error('invalid signature');
        }),
      });

      const error = await captureError(sliceImage(opts, deps));

      expect(error.message).toBe('Could not decode --in as PNG: invalid signature');
      expectNothingWritten(deps);
    });

    it('refuses an image over the pixel limit', async () => {
      const deps = createDeps({
        decodePng: vi.fn(() => ({ width: 10_001, height: 10_001, data: new Uint8Array(0) })),
      });

      const error = await captureError(sliceImage(opts, deps));

      expect(error.message).toContain('maximum is 100000000 pixels');
      expectNothingWritten(deps);
    });

    it('refuses --names together with --prefix before decoding', async () => {
      const deps = createDeps();

      const error = await captureError(sliceImage({ ...opts, prefix: 'sheet' }, deps));

      expect(error.message).toBe('--names and --prefix are mutually exclusive.');
      expect(deps.decodePng).not.toHaveBeenCalled();
      expectNothingWritten(deps);
    });

    it('refuses an existing tile png without --force', async () => {
      const deps = createDeps({
        pathStatus: pathStatusFor({ [resolve('/tmp/tiles/hero.png')]: 'file' }),
      });

      const error = await captureError(sliceImage(opts, deps));

      expect(error.message).toContain(`${resolve('/tmp/tiles/hero.png')}: already exists`);
      expect(error.message).toContain('Pass --force to overwrite.');
      expectNothingWritten(deps);
    });

    it('refuses an existing tile json without --force', async () => {
      const deps = createDeps({
        pathStatus: pathStatusFor({ [resolve('/tmp/tiles/orc.png.json')]: 'file' }),
      });

      const error = await captureError(sliceImage(opts, deps));

      expect(error.message).toContain(`${resolve('/tmp/tiles/orc.png.json')}: already exists`);
      expectNothingWritten(deps);
    });

    it('refuses a sidecar-only collision without --force and lists the json path', async () => {
      // Only hero.png.json exists; hero.png is missing on disk.
      const jsonPath = resolve('/tmp/tiles/hero.png.json');
      const deps = createDeps({
        pathStatus: pathStatusFor({ [jsonPath]: 'file' }),
      });

      const error = await captureError(
        sliceImage({ in: IN_PATH, outDir: OUT_DIR, cols: 1, rows: 1, names: ['hero'] }, deps)
      );

      expect(error).toBeInstanceOf(SliceImageError);
      expect(error.message).toContain(`${jsonPath}: already exists`);
      expect(error.message).toContain('Pass --force to overwrite.');
      expectNothingWritten(deps);
    });

    it('refuses a directory in the way', async () => {
      const deps = createDeps({
        pathStatus: pathStatusFor({ [resolve('/tmp/tiles/goblin.png')]: 'directory' }),
      });

      const error = await captureError(sliceImage(opts, deps));

      expect(error.message).toContain('a directory is in the way');
      expectNothingWritten(deps);
    });

    it('refuses an output that collides with the source, even with --force', async () => {
      const deps = createDeps();
      const colliding = {
        in: IN_PATH,
        outDir: resolve('/tmp/sheets'),
        cols: 1,
        rows: 1,
        names: ['sheet'],
        force: true,
      };

      const error = await captureError(sliceImage(colliding, deps));

      expect(error.message).toContain('this is the source sheet or its manifest');
      expectNothingWritten(deps);
    });

    it('refuses a case-variant output by file identity, even with --force', async () => {
      const heroIn = resolve('/tmp/sheets/Hero.png');
      const deps = createDeps({
        statInput: vi.fn(async (path: string): Promise<InputStat> => {
          if (path === heroIn) return { kind: 'file', size: SHEET_BYTES.byteLength };
          return { kind: 'missing', size: 0 };
        }),
        fileIdentity: fileIdentityFor({
          [heroIn]: SOURCE_IDENTITY,
          [resolve('/tmp/sheets/hero.png')]: SOURCE_IDENTITY,
        }),
      });

      const error = await captureError(
        sliceImage(
          {
            in: heroIn,
            outDir: resolve('/tmp/sheets'),
            cols: 1,
            rows: 1,
            names: ['hero'],
            force: true,
          },
          deps
        )
      );

      expect(error.message).toContain(
        `${resolve('/tmp/sheets/hero.png')}: this resolves to the source sheet or its manifest`
      );
      expectNothingWritten(deps);
    });

    it('refuses an output that is the same file as the source, even with --force', async () => {
      const deps = createDeps({
        fileIdentity: fileIdentityFor({ [resolve('/tmp/tiles/hero.png')]: SOURCE_IDENTITY }),
      });

      const error = await captureError(
        sliceImage(
          { in: IN_PATH, outDir: OUT_DIR, cols: 1, rows: 1, names: ['hero'], force: true },
          deps
        )
      );

      expect(error.message).toContain('resolves to the source sheet or its manifest');
      expectNothingWritten(deps);
    });

    it('refuses a symlinked output, even with --force', async () => {
      const symlinkPath = resolve('/tmp/tiles/hero.png');
      const deps = createDeps({
        isSymlink: vi.fn(async (path: string) => path === symlinkPath),
      });

      const error = await captureError(
        sliceImage(
          { in: IN_PATH, outDir: OUT_DIR, cols: 1, rows: 1, names: ['hero'], force: true },
          deps
        )
      );

      expect(error.message).toContain(`${symlinkPath}: this is a symbolic link`);
      expectNothingWritten(deps);
    });

    it('refuses a dangling symlink output before pathStatus calls it missing', async () => {
      const symlinkPath = resolve('/tmp/tiles/hero.png');
      const deps = createDeps({
        pathStatus: pathStatusFor({ [symlinkPath]: 'missing' }),
        isSymlink: vi.fn(async (path: string) => path === symlinkPath),
      });

      const error = await captureError(sliceImage(opts, deps));

      expect(error.message).toContain(`${symlinkPath}: this is a symbolic link`);
      expectNothingWritten(deps);
    });

    it('lists every conflict in one error', async () => {
      const deps = createDeps({
        pathStatus: pathStatusFor({
          [resolve('/tmp/tiles/hero.png')]: 'file',
          [resolve('/tmp/tiles/goblin.png.json')]: 'file',
        }),
      });

      const error = await captureError(sliceImage(opts, deps));

      expect(error.message).toContain(resolve('/tmp/tiles/hero.png'));
      expect(error.message).toContain(resolve('/tmp/tiles/goblin.png.json'));
      expect(error.message).toContain('Refusing to write 2 output file(s)');
      expectNothingWritten(deps);
    });
  });

  it('overwrites existing files when --force is passed', async () => {
    const deps = createDeps({
      pathStatus: pathStatusFor({
        [resolve('/tmp/tiles/hero.png')]: 'file',
        [resolve('/tmp/tiles/hero.png.json')]: 'file',
      }),
    });

    await sliceImage({ ...opts, force: true }, deps);

    expect(deps.writeFile).toHaveBeenCalledTimes(3);
    expect(deps.writeJson).toHaveBeenCalledTimes(4);
  });

  it('uses exclusive writes without --force and overwrites with it', async () => {
    const safe = createDeps();

    await sliceImage(opts, safe);

    expect(safe.writeFile).toHaveBeenCalledWith(
      resolve('/tmp/tiles/hero.png'),
      expect.any(Uint8Array),
      { exclusive: true }
    );
    expect(safe.writeJson).toHaveBeenCalledWith(
      resolve('/tmp/tiles/sheet.slices.json'),
      expect.anything(),
      { exclusive: true }
    );

    const forced = createDeps({
      pathStatus: pathStatusFor({
        [resolve('/tmp/tiles/hero.png')]: 'file',
        [resolve('/tmp/tiles/hero.png.json')]: 'file',
      }),
    });

    await sliceImage({ ...opts, force: true }, forced);

    expect(forced.writeFile).toHaveBeenCalledWith(
      resolve('/tmp/tiles/hero.png'),
      expect.any(Uint8Array),
      { exclusive: false }
    );
    expect(forced.writeJson).toHaveBeenCalledWith(
      resolve('/tmp/tiles/sheet.slices.json'),
      expect.anything(),
      { exclusive: false }
    );
  });

  it('dry-run writes nothing but still reports tiles and refusals', async () => {
    const deps = createDeps();

    const result = await sliceImage({ ...opts, dryRun: true }, deps);

    expect(result.dryRun).toBe(true);
    expect(result.tiles.map((tile) => tile.name)).toEqual(['hero', 'goblin', 'orc']);
    expect(result.tiles.every((tile) => tile.sha256.length === 64)).toBe(true);
    expect(deps.ensureDir).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.writeJson).not.toHaveBeenCalled();

    const conflicts = createDeps({
      pathStatus: pathStatusFor({ [resolve('/tmp/tiles/hero.png')]: 'file' }),
    });
    const error = await captureError(sliceImage({ ...opts, dryRun: true }, conflicts));
    expect(error.message).toContain('already exists');
    expect(conflicts.writeFile).not.toHaveBeenCalled();
  });

  it('does not touch the disk when encoding fails', async () => {
    const deps = createDeps({
      encodePng: vi.fn(() => {
        throw new Error('encoder exploded');
      }),
    });

    const error = await captureError(sliceImage(opts, deps));

    expect(error.message).toContain('Could not encode tile');
    expect(deps.ensureDir).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.writeJson).not.toHaveBeenCalled();
  });

  it('names the failed path and already-written files on a mid-write error', async () => {
    const writeFile = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('disk full'));
    const deps = createDeps({ writeFile });
    // Two active tiles: the first writes png then json, the second fails on png.
    const twoTiles = { ...opts, names: ['hero', 'goblin', '', ''] };

    const error = await captureError(sliceImage(twoTiles, deps));

    expect(error.message).toContain(`Failed to write ${resolve('/tmp/tiles/goblin.png')}`);
    expect(error.message).toContain('disk full');
    expect(error.message).toContain(resolve('/tmp/tiles/hero.png'));
    expect(error.message).toContain(resolve('/tmp/tiles/hero.png.json'));
    expect(error.message).toContain('Re-run with --force');
    const indexCall = (deps.writeJson as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === resolve('/tmp/tiles/sheet.slices.json')
    );
    expect(indexCall).toBeUndefined();
  });

  it('reports allow-remainder drops in the result and index', async () => {
    const deps = createDeps({ decodePng: vi.fn(() => makeImage(4, 4)) });

    const result = await sliceImage(
      { in: IN_PATH, outDir: OUT_DIR, cols: 3, rows: 1, allowRemainder: true },
      deps
    );

    expect(result.tileSize).toEqual({ width: 1, height: 4 });
    expect(result.droppedRemainder).toEqual({ right: 1, bottom: 0 });
    expect(result.warnings.some((warning) => warning.includes('Dropped 1px'))).toBe(true);

    const index = (deps.writeJson as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1] as {
      grid: Record<string, number>;
    };
    expect(index.grid).toMatchObject({
      tileWidth: 1,
      tileHeight: 4,
      droppedRight: 1,
      droppedBottom: 0,
    });
  });
});
