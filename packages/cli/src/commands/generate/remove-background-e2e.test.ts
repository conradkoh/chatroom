/**
 * `chatroom remove-image-background` end-to-end tests.
 *
 * The synthetic test runs the real slice-image then the real keying command and
 * checks pixels, manifests, the provenance chain, refusals, and deterministic
 * reruns. The real-pixel test uses the Nano Banana 2 potion tile when present.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pngjs from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const { PNG } = pngjs;

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const CELL = 16;
const BACKGROUND: [number, number, number, number] = [230, 230, 230, 255];
const RED: [number, number, number, number] = [200, 40, 40, 255];
const BLUE: [number, number, number, number] = [40, 60, 200, 255];

interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): CliRun {
  const env = { ...process.env };
  delete env.FAL_API_KEY;
  const result = spawnSync('bun', ['run', 'src/index.ts', ...args], {
    cwd: CLI_ROOT,
    env,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function buildSheet(): Uint8Array {
  const image = new PNG({ width: CELL * 2, height: CELL });
  for (let offset = 0; offset < image.data.length; offset += 4) image.data.set(BACKGROUND, offset);
  for (const [cell, colour] of [
    [0, RED],
    [1, BLUE],
  ] as const) {
    for (let y = 4; y < 12; y += 1) {
      for (let x = cell * CELL + 4; x < cell * CELL + 12; x += 1) {
        image.data.set(colour, (y * CELL * 2 + x) * 4);
      }
    }
  }
  return PNG.sync.write(image, { colorType: 6, deflateLevel: 9 });
}

function alphaAt(image: InstanceType<typeof PNG>, x: number, y: number): number {
  return image.data[(y * image.width + x) * 4 + 3] ?? 0;
}

function pixelAt(image: InstanceType<typeof PNG>, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4;
  return Array.from(image.data.subarray(offset, offset + 4));
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('chatroom remove-image-background (end-to-end)', () => {
  let dir: string;
  let sheetPath: string;
  let tilesDir: string;
  let assetsDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'chatroom-remove-bg-e2e-'));
    sheetPath = join(dir, 'sheet.png');
    tilesDir = join(dir, 'tiles');
    assetsDir = join(dir, 'assets');
    await writeFile(sheetPath, buildSheet());
    const sliced = runCli([
      'slice-image',
      '--in',
      sheetPath,
      '--out-dir',
      tilesDir,
      '--cols',
      '2',
      '--rows',
      '1',
      '--names',
      'a,b',
    ]);
    expect(sliced.status).toBe(0);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('isolates sliced tiles, keeps colours, and records the provenance chain', async () => {
    const run = runCli([
      'remove-image-background',
      '--in-dir',
      tilesDir,
      '--out-dir',
      assetsDir,
      '--map',
      'a=potion,b=sword',
    ]);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('Isolated');
    expect(run.stdout).toContain('1 region(s)');

    const sheetSha = createHash('sha256')
      .update(await readFile(sheetPath))
      .digest('hex');
    for (const [name, colour] of [
      ['potion', RED],
      ['sword', BLUE],
    ] as const) {
      const assetPath = join(assetsDir, `${name}.png`);
      const bytes = await readFile(assetPath);
      const image = PNG.sync.read(bytes);
      expect(image.width).toBe(CELL);
      expect(image.height).toBe(CELL);
      expect(pixelAt(image, 8, 8)).toEqual([...colour]);
      expect(alphaAt(image, 0, 0)).toBe(0);
      expect(alphaAt(image, CELL - 1, CELL - 1)).toBe(0);

      const manifest = JSON.parse(await readFile(`${assetPath}.json`, 'utf8')) as {
        source: {
          path: string;
          sha256: string;
          manifest: { outputSha256: string; sheet: { sha256: string } } | null;
        };
        output: { sha256: string; path: string };
        naming: { assignedName: string; assignedBy: string };
      };
      expect(manifest.source.sha256).toBe(
        createHash('sha256')
          .update(await readFile(manifest.source.path))
          .digest('hex')
      );
      expect(manifest.source.manifest?.sheet.sha256).toBe(sheetSha);
      expect(manifest.output.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(manifest.output.path).toBe(assetPath);
      expect(manifest.naming).toEqual({
        sourceStem: name === 'potion' ? 'a' : 'b',
        assignedName: name,
        assignedBy: 'map',
      });
    }
  }, 30_000);

  it('trims to the content box with padding and keeps the pre-crop geometry', async () => {
    const trimmedDir = join(dir, 'trimmed');
    const run = runCli([
      'remove-image-background',
      '--in-dir',
      tilesDir,
      '--out-dir',
      trimmedDir,
      '--map',
      'a=potion,b=sword',
      '--trim',
      '--trim-padding',
      '2',
    ]);

    expect(run.status).toBe(0);
    for (const name of ['potion', 'sword']) {
      const assetPath = join(trimmedDir, `${name}.png`);
      const image = PNG.sync.read(await readFile(assetPath));
      expect(image.width).toBe(12);
      expect(image.height).toBe(12);
      expect(alphaAt(image, 0, 0)).toBe(0);
      expect(alphaAt(image, 6, 6)).toBe(255);

      const manifest = JSON.parse(await readFile(`${assetPath}.json`, 'utf8')) as {
        trim: {
          padding: number;
          rect: Record<string, number>;
          sizeBefore: Record<string, number>;
          sizeAfter: Record<string, number>;
        };
        output: { width: number; height: number };
        result: { contentBox: Record<string, number> };
      };
      expect(manifest.trim).toEqual({
        padding: 2,
        rect: { x: 2, y: 2, width: 12, height: 12 },
        sizeBefore: { width: 16, height: 16 },
        sizeAfter: { width: 12, height: 12 },
      });
      expect(manifest.output).toMatchObject({ width: 12, height: 12 });
      expect(manifest.result.contentBox).toEqual({ x: 4, y: 4, width: 8, height: 8 });
    }
  }, 30_000);

  it('refuses a second run without --force and reproduces bytes with --force', async () => {
    const args = [
      'remove-image-background',
      '--in-dir',
      tilesDir,
      '--out-dir',
      assetsDir,
      '--map',
      'a=potion,b=sword',
    ];
    expect(runCli(args).status).toBe(0);
    const first = await readFile(join(assetsDir, 'potion.png'));

    const refused = runCli(args);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain('already exists');

    const forced = runCli([...args, '--force']);
    expect(forced.status).toBe(0);
    const second = await readFile(join(assetsDir, 'potion.png'));
    expect(Array.from(second)).toEqual(Array.from(first));
  }, 30_000);
});

const fixtureDir =
  process.env.CHATROOM_BG_FIXTURE_DIR ??
  join(process.env.HOME ?? '', 'Downloads/slice-image-nanobanana2-20261022-193147/nb2/tiles');
const potionFixture = join(fixtureDir, 'potion.png');
const fixtureAvailable = await exists(potionFixture).catch(() => false);

describe.skipIf(!fixtureAvailable)('real potion tile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'chatroom-remove-bg-real-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('matches the measured potion keying values at defaults', async () => {
    const input = join(dir, 'potion.png');
    await copyFile(potionFixture, input);
    const output = join(dir, 'potion-isolated.png');

    const run = runCli(['remove-image-background', '--in', input, '--out', output]);
    expect(run.status).toBe(0);

    const image = PNG.sync.read(await readFile(output));
    expect(image.width).toBe(352);
    expect(image.height).toBe(256);
    expect(alphaAt(image, 0, 0)).toBe(0);
    expect(alphaAt(image, 176, 128)).toBe(255);

    const manifest = JSON.parse(await readFile(`${output}.json`, 'utf8')) as {
      keying: { background: number[] };
      result: {
        components: number;
        foregroundPixels: number;
        contentBox: Record<string, number>;
        centerOffset: Record<string, number>;
      };
    };
    expect(manifest.keying.background).toEqual([193, 199, 206]);
    expect(manifest.result.components).toBe(1);
    expect(manifest.result.foregroundPixels).toBe(19806);
    expect(manifest.result.contentBox).toEqual({ x: 105, y: 29, width: 142, height: 200 });
    expect(manifest.result.centerOffset).toEqual({ x: 0, y: 1 });
  }, 30_000);

  it('trims the potion to 142x200 and 146x204 with padding 2', async () => {
    const input = join(dir, 'potion.png');
    await copyFile(potionFixture, input);
    const zero = join(dir, 'potion-trim0.png');
    const two = join(dir, 'potion-trim2.png');

    expect(runCli(['remove-image-background', '--in', input, '--out', zero, '--trim']).status).toBe(
      0
    );
    expect(
      runCli([
        'remove-image-background',
        '--in',
        input,
        '--out',
        two,
        '--trim',
        '--trim-padding',
        '2',
      ]).status
    ).toBe(0);

    const zeroImage = PNG.sync.read(await readFile(zero));
    const twoImage = PNG.sync.read(await readFile(two));
    expect({ width: zeroImage.width, height: zeroImage.height }).toEqual({
      width: 142,
      height: 200,
    });
    expect({ width: twoImage.width, height: twoImage.height }).toEqual({ width: 146, height: 204 });

    const zeroManifest = JSON.parse(await readFile(`${zero}.json`, 'utf8')) as {
      trim: { padding: number; rect: Record<string, number> };
    };
    const twoManifest = JSON.parse(await readFile(`${two}.json`, 'utf8')) as {
      trim: { padding: number; rect: Record<string, number> };
    };
    expect(zeroManifest.trim).toMatchObject({
      padding: 0,
      rect: { x: 105, y: 29, width: 142, height: 200 },
    });
    expect(twoManifest.trim).toMatchObject({
      padding: 2,
      rect: { x: 103, y: 27, width: 146, height: 204 },
    });
  }, 30_000);
});
