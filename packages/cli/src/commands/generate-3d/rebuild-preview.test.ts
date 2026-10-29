/**
 * Rebuild-preview tests.
 *
 * A package zip is the only input. The tests build one with the real
 * `zipPackage`, then assert that the page embeds both variants, that a broken
 * package fails before writing anything, and that an existing page is only
 * replaced with `--force`.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { rebuildPreviewFromZip } from './rebuild-preview.js';
import { zipPackage, type ZipEntry } from './zip-package.js';

/** A minimal GLB: magic "glTF", version 2, then a few payload bytes. */
const MASTER_GLB = new Uint8Array([
  0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00, 1, 2, 3, 4, 5, 6,
]);
const WEB_GLB = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00, 7, 8, 9, 10]);

const BASE = 'chest-20261028-011838';
const ZIP_NAME = `${BASE}.zip`;
const WEB_SHA256 = 'c3b41eb0c19ffb1a753ac5f9463264e612d08ca9c586c08a239954897931a1cd';

const MANIFEST = {
  schemaVersion: 1,
  package: { name: BASE, zip: ZIP_NAME, createdAt: '2026-10-28T01:18:38.000Z' },
  generator: {
    tool: 'chatroom generate-3d',
    model: 'meshy/v7.1/text-to-3d',
    requestId: '01a18014-bd89-74b0-a036-735c60221501',
    prompt: 'a low-poly wooden treasure chest with iron bands, game prop',
    inputImage: null,
  },
  variants: [
    {
      name: 'master',
      file: 'chest.glb',
      bytes: MASTER_GLB.byteLength,
      sha256: 'a'.repeat(64),
      triangles: 48_984,
    },
    {
      name: 'web',
      file: 'web/chest.web.glb',
      bytes: WEB_GLB.byteLength,
      sha256: WEB_SHA256,
      triangles: 27_438,
    },
  ],
};

/** Temp dirs created by the tests. */
const dirs: string[] = [];

async function createDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'generate-3d-preview-'));
  dirs.push(dir);
  return dir;
}

/** The default package: manifest plus both GLBs. */
function packageEntries(overrides: ZipEntry[] = []): ZipEntry[] {
  return [
    { path: 'chest.glb', bytes: MASTER_GLB },
    { path: 'web/chest.web.glb', bytes: WEB_GLB },
    {
      path: 'manifest.json',
      bytes: new TextEncoder().encode(JSON.stringify(MANIFEST)),
    },
    ...overrides,
  ];
}

/** Write a zip into a fresh temp dir and return its path. */
async function writePackage(dir: string, entries: ZipEntry[] = packageEntries()): Promise<string> {
  const zipPath = join(dir, ZIP_NAME);
  await writeFile(zipPath, zipPackage(entries));
  return zipPath;
}

/** The base64 payload of the viewer's `src` (the web variant). */
function embeddedWebBase64(html: string): string {
  const match = html.match(
    /<model-viewer\s+src="data:model\/gltf-binary;base64,([A-Za-z0-9+/=]+)"/
  );
  if (match === null) throw new Error('no embedded web GLB data URI found');
  return match[1] as string;
}

/** The base64 payload of the viewer's `data-master-src`. */
function embeddedMasterBase64(html: string): string {
  const match = html.match(/data-master-src="data:model\/gltf-binary;base64,([A-Za-z0-9+/=]+)"/);
  if (match === null) throw new Error('no embedded master GLB data URI found');
  return match[1] as string;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('rebuildPreviewFromZip', () => {
  it('writes <base>.html beside the zip with both variants embedded', async () => {
    const dir = await createDir();
    const zipPath = await writePackage(dir);

    const htmlPath = await rebuildPreviewFromZip(zipPath, { force: false });

    expect(htmlPath).toBe(join(dir, `${BASE}.html`));
    const html = await readFile(htmlPath, 'utf8');
    expect(html.split('data:model/gltf-binary;base64,').length - 1).toBe(2);
    expect(Buffer.from(embeddedMasterBase64(html), 'base64').equals(Buffer.from(MASTER_GLB))).toBe(
      true
    );
    expect(Buffer.from(embeddedWebBase64(html), 'base64').equals(Buffer.from(WEB_GLB))).toBe(true);
    expect(html).toContain('<title>chest-20261028-011838 — 3D preview</title>');
    expect(html).toContain('48,984 master / 27,438 web');
    expect(html).toContain(WEB_SHA256);
    expect(html).toContain('chest.glb (in chest-20261028-011838.zip)');
  });

  it('fails without writing when the web GLB is missing', async () => {
    const dir = await createDir();
    const zipPath = await writePackage(
      dir,
      packageEntries().filter((entry) => entry.path !== 'web/chest.web.glb')
    );

    await expect(rebuildPreviewFromZip(zipPath, { force: false })).rejects.toThrow(
      /web GLB web\/chest\.web\.glb is missing from the zip/
    );
    await expect(readFile(join(dir, `${BASE}.html`))).rejects.toThrow(/ENOENT/);
  });

  it('fails without writing when the manifest is missing', async () => {
    const dir = await createDir();
    const zipPath = await writePackage(
      dir,
      packageEntries().filter((entry) => entry.path !== 'manifest.json')
    );

    await expect(rebuildPreviewFromZip(zipPath, { force: false })).rejects.toThrow(
      /manifest\.json is missing from the zip/
    );
    await expect(readFile(join(dir, `${BASE}.html`))).rejects.toThrow(/ENOENT/);
  });

  it('fails without writing when a GLB length disagrees with the manifest', async () => {
    const dir = await createDir();
    const zipPath = await writePackage(
      dir,
      packageEntries().map((entry) =>
        entry.path === 'web/chest.web.glb'
          ? { ...entry, bytes: new Uint8Array([...WEB_GLB, 11]) }
          : entry
      )
    );

    await expect(rebuildPreviewFromZip(zipPath, { force: false })).rejects.toThrow(
      /web\/chest\.web\.glb is 13 bytes in the zip, but manifest\.json says 12/
    );
    await expect(readFile(join(dir, `${BASE}.html`))).rejects.toThrow(/ENOENT/);
  });

  it('keeps an existing preview without --force', async () => {
    const dir = await createDir();
    const zipPath = await writePackage(dir);
    const htmlPath = join(dir, `${BASE}.html`);
    await writeFile(htmlPath, 'keep me', 'utf8');

    await expect(rebuildPreviewFromZip(zipPath, { force: false })).rejects.toThrow(
      new RegExp(`Preview already exists: ${htmlPath}. Pass --force to overwrite.`)
    );
    expect(await readFile(htmlPath, 'utf8')).toBe('keep me');
  });

  it('replaces an existing preview with --force', async () => {
    const dir = await createDir();
    const zipPath = await writePackage(dir);
    const htmlPath = join(dir, `${BASE}.html`);
    await writeFile(htmlPath, 'keep me', 'utf8');

    await rebuildPreviewFromZip(zipPath, { force: true });

    expect(await readFile(htmlPath, 'utf8')).not.toBe('keep me');
  });
});
