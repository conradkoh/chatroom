/**
 * `chatroom slice-image` end-to-end test.
 *
 * Builds a real PNG sheet with pngjs, runs the real CLI entry in a temp
 * directory, then decodes the outputs with pngjs and checks pixels, hashes,
 * manifests, and the force refusal. No network and no fal SDK.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pngjs from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const { PNG } = pngjs;

type PngImage = InstanceType<typeof PNG>;

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const COLS = 4;
const ROWS = 3;
const CELL_WIDTH = 16;
const CELL_HEIGHT = 8;

interface Sheet {
  bytes: Uint8Array;
  sha256: string;
  image: PngImage;
}

function cellColor(row: number, col: number): number[] {
  return [10 + row * 40, 20 + col * 30, 30 + (row * COLS + col) * 15, 255];
}

/** A 4x3 sheet with a clean background border and one inset colour per cell. */
function buildSheet(): Sheet {
  const width = COLS * CELL_WIDTH;
  const height = ROWS * CELL_HEIGHT;
  const image = new PNG({ width, height });
  const background: [number, number, number, number] = [230, 230, 230, 255];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      image.data.set(background, (y * width + x) * 4);
    }
  }
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const [r, g, b] = cellColor(row, col);
      // Cell (row 1, col 2) is translucent to prove alpha is preserved.
      const alpha = row === 1 && col === 2 ? 200 : 255;
      const left = col * CELL_WIDTH + 3;
      const top = row * CELL_HEIGHT + 2;
      for (let y = top; y < top + CELL_HEIGHT - 4; y += 1) {
        for (let x = left; x < left + CELL_WIDTH - 6; x += 1) {
          image.data.set([r ?? 0, g ?? 0, b ?? 0, alpha], (y * width + x) * 4);
        }
      }
    }
  }
  const bytes = PNG.sync.write(image, { colorType: 6, deflateLevel: 9 });
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex'), image };
}

/** 32x32 sheet with one item straddling the border between the left and right cells. */
function buildCrossingSheet(): Sheet {
  const width = 32;
  const height = 32;
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      image.data.set([230, 230, 230, 255], (y * width + x) * 4);
    }
  }
  for (let y = 6; y < 10; y += 1) {
    for (let x = 14; x < 18; x += 1) {
      image.data.set([200, 40, 40, 255], (y * width + x) * 4);
    }
  }
  const bytes = PNG.sync.write(image, { colorType: 6, deflateLevel: 9 });
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex'), image };
}

function pixelAt(image: PngImage, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4;
  return Array.from(image.data.subarray(offset, offset + 4));
}

function cropPixels(
  image: PngImage,
  x: number,
  y: number,
  width: number,
  height: number
): number[] {
  const pixels: number[] = [];
  for (let row = 0; row < height; row += 1) {
    const start = ((y + row) * image.width + x) * 4;
    pixels.push(...image.data.subarray(start, start + width * 4));
  }
  return pixels;
}

interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): CliRun {
  const env = { ...process.env };
  delete env.FAL_API_KEY;
  const result = spawnSync('bun', ['run', 'src/index.ts', 'slice-image', ...args], {
    cwd: CLI_ROOT,
    env,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('chatroom slice-image (end-to-end)', () => {
  let dir: string;
  let sheet: Sheet;
  let sheetPath: string;
  let outDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'chatroom-slice-e2e-'));
    sheet = buildSheet();
    sheetPath = join(dir, 'sheet.png');
    outDir = join(dir, 'tiles');
    await writeFile(sheetPath, sheet.bytes);
    await writeFile(
      `${sheetPath}.json`,
      `${JSON.stringify(
        {
          platform: 'fal',
          tool: 'chatroom generate-image',
          sdk: '@fal-ai/client@1.10.1',
          model: 'fal-ai/flux-2/flash',
          input: { prompt: 'a grid of sprites' },
          requestId: 'req-e2e',
          seed: 42,
          output: {
            path: sheetPath,
            sha256: sheet.sha256,
            contentType: 'image/png',
            bytes: sheet.bytes.byteLength,
          },
          generatedAt: '2026-01-01T00:00:00.000Z',
          licensing: 'unverified',
        },
        null,
        2
      )}\n`
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('slices real pixels, writes hashed manifests, and refuses a rerun without --force', async () => {
    const run = runCli([
      '--in',
      sheetPath,
      '--out-dir',
      outDir,
      '--cols',
      String(COLS),
      '--rows',
      String(ROWS),
    ]);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain(
      `Sheet ${sheetPath} (${sheet.image.width}x${sheet.image.height}, sha256 ${sheet.sha256.slice(0, 12)}) -> 4x3 grid, tile ${CELL_WIDTH}x${CELL_HEIGHT}`
    );
    expect(run.stdout).not.toContain('Skipped cells');

    const index = JSON.parse(await readFile(join(outDir, 'sheet.slices.json'), 'utf8')) as {
      tool: string;
      decoder: string;
      source: { sha256: string; manifestPath: string; manifest: { requestId: string } };
      grid: Record<string, number>;
      tiles: { index: number; row: number; col: number; name: string; sha256: string }[];
      skipped: number[];
      licensing: string;
    };
    expect(index.tool).toBe('chatroom slice-image');
    expect(index.decoder).toMatch(/^pngjs@\d+\.\d+\.\d+/);
    expect(index.source.sha256).toBe(sheet.sha256);
    expect(index.source.manifestPath).toBe(`${sheetPath}.json`);
    expect(index.source.manifest.requestId).toBe('req-e2e');
    expect(index.grid).toMatchObject({
      cols: COLS,
      rows: ROWS,
      tileWidth: CELL_WIDTH,
      tileHeight: CELL_HEIGHT,
      droppedRight: 0,
      droppedBottom: 0,
    });
    expect(index.tiles).toHaveLength(COLS * ROWS);
    expect(index.skipped).toEqual([]);
    expect(index.licensing).toBe('unverified');

    for (const [expectedIndex, tile] of index.tiles.entries()) {
      const row = Math.floor(expectedIndex / COLS);
      const col = expectedIndex % COLS;
      expect(tile).toMatchObject({
        index: expectedIndex,
        row,
        col,
        name: `sheet-${String(expectedIndex + 1).padStart(2, '0')}`,
      });

      const tilePath = join(outDir, `${tile.name}.png`);
      const tileBytes = await readFile(tilePath);
      const tileImage = PNG.sync.read(tileBytes);
      expect(tileImage.width).toBe(CELL_WIDTH);
      expect(tileImage.height).toBe(CELL_HEIGHT);
      expect(cropPixels(tileImage, 0, 0, CELL_WIDTH, CELL_HEIGHT)).toEqual(
        cropPixels(sheet.image, col * CELL_WIDTH, row * CELL_HEIGHT, CELL_WIDTH, CELL_HEIGHT)
      );
      expect(tile.sha256).toBe(createHash('sha256').update(tileBytes).digest('hex'));

      const manifest = JSON.parse(await readFile(`${tilePath}.json`, 'utf8')) as {
        tool: string;
        source: { sha256: string };
        grid: Record<string, number>;
        crop: Record<string, number>;
        output: { sha256: string; path: string; width: number; height: number; hasAlpha: boolean };
        licensing: string;
      };
      expect(manifest.tool).toBe('chatroom slice-image');
      expect(manifest.source.sha256).toBe(sheet.sha256);
      expect(manifest.grid).toMatchObject({ row, col, index: expectedIndex });
      expect(manifest.crop).toEqual({
        x: col * CELL_WIDTH,
        y: row * CELL_HEIGHT,
        width: CELL_WIDTH,
        height: CELL_HEIGHT,
      });
      expect(manifest.output).toMatchObject({
        path: tilePath,
        sha256: tile.sha256,
        width: CELL_WIDTH,
        height: CELL_HEIGHT,
        hasAlpha: row === 1 && col === 2,
      });
      expect(manifest.licensing).toBe('unverified');
    }

    // Tile (row 1, col 2) in particular must be pixel-identical to its source region.
    const translucent = PNG.sync.read(await readFile(join(outDir, 'sheet-07.png')));
    expect(cropPixels(translucent, 0, 0, CELL_WIDTH, CELL_HEIGHT)).toEqual(
      cropPixels(sheet.image, 2 * CELL_WIDTH, CELL_HEIGHT, CELL_WIDTH, CELL_HEIGHT)
    );
    expect(pixelAt(translucent, 0, 0)[3]).toBe(255);
    expect(pixelAt(translucent, 3, 2)[3]).toBe(200);

    const rerun = runCli([
      '--in',
      sheetPath,
      '--out-dir',
      outDir,
      '--cols',
      String(COLS),
      '--rows',
      String(ROWS),
    ]);
    expect(rerun.status).not.toBe(0);
    expect(rerun.stderr).toContain('already exists');
    expect(rerun.stderr).toContain('Pass --force to overwrite.');
  }, 30_000);

  it('refuses a non-divisible grid and succeeds with --allow-remainder', async () => {
    const remainderDir = join(dir, 'remainder');
    const baseArgs = ['--in', sheetPath, '--out-dir', remainderDir, '--cols', '5', '--rows', '2'];

    const refused = runCli(baseArgs);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain('does not divide into 5 cols x 2 rows');
    expect(refused.stderr).toContain('--allow-remainder');
    await expect(exists(remainderDir)).resolves.toBe(false);

    const allowed = runCli([...baseArgs, '--allow-remainder', '--allow-edge-content']);
    expect(allowed.status).toBe(0);

    const index = JSON.parse(await readFile(join(remainderDir, 'sheet.slices.json'), 'utf8')) as {
      grid: Record<string, number>;
    };
    expect(index.grid).toMatchObject({
      tileWidth: 12,
      tileHeight: 12,
      droppedRight: 4,
      droppedBottom: 0,
    });
  }, 30_000);

  it('refuses artwork crossing cell borders and slices with --allow-edge-content', async () => {
    const crossing = buildCrossingSheet();
    const crossingPath = join(dir, 'crossing.png');
    const crossingOut = join(dir, 'crossing-tiles');
    await writeFile(crossingPath, crossing.bytes);

    const args = [
      '--in',
      crossingPath,
      '--out-dir',
      crossingOut,
      '--cols',
      '2',
      '--rows',
      '2',
      '--names',
      'a,b,c,d',
    ];

    const refused = runCli(args);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('Artwork crosses cell borders in 2 of 4 cells');
    expect(refused.stderr).toContain('--allow-edge-content');
    await expect(exists(crossingOut)).resolves.toBe(false);

    const allowed = runCli([...args, '--allow-edge-content']);
    expect(allowed.status).toBe(0);
    for (const name of ['a', 'b', 'c', 'd']) {
      await expect(exists(join(crossingOut, `${name}.png`))).resolves.toBe(true);
    }
  }, 30_000);
});
