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

import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { afterEach, describe, expect, it } from 'vitest';

import { rebuildPreviewFromZip } from './rebuild-preview.js';
import { zipPackage, type ZipEntry } from './zip-package.js';

/** A valid box GLB, centred on the origin, so the page gets `not-on-feet`. */
async function buildMasterGlb(): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const positions = doc
    .createAccessor('positions')
    .setType('VEC3')
    .setArray(
      new Float32Array([
        -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5,
        -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
      ])
    )
    .setBuffer(buffer);
  const indices = doc
    .createAccessor('indices')
    .setType('SCALAR')
    .setArray(
      new Uint16Array([
        4, 5, 6, 4, 6, 7, 1, 0, 3, 1, 3, 2, 0, 4, 7, 0, 7, 3, 5, 1, 2, 5, 2, 6, 3, 7, 6, 3, 6, 2, 0,
        1, 5, 0, 5, 4,
      ])
    )
    .setBuffer(buffer);
  const material = doc.createMaterial('box');
  const primitive = doc
    .createPrimitive()
    .setAttribute('POSITION', positions)
    .setIndices(indices)
    .setMaterial(material);
  const mesh = doc.createMesh('box').addPrimitive(primitive);
  doc.createScene('scene').addChild(doc.createNode('box-node').setMesh(mesh));
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
    .writeBinary(doc);
}

/** A valid empty GLB; the rebuild embeds the web variant but checks the master. */
async function buildWebGlb(): Promise<Uint8Array> {
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
    .writeBinary(new Document());
}

/** A valid GLB whose MR image bytes are not a decodable PNG. */
async function buildUnreadableMasterGlb(): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const positions = doc
    .createAccessor('positions')
    .setType('VEC3')
    .setArray(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]))
    .setBuffer(buffer);
  const texture = doc
    .createTexture('unreadable')
    .setImage(new Uint8Array([1, 2, 3, 4]))
    .setMimeType('image/png');
  const material = doc.createMaterial('unreadable').setMetallicRoughnessTexture(texture);
  const primitive = doc.createPrimitive().setAttribute('POSITION', positions).setMaterial(material);
  const mesh = doc.createMesh('unreadable').addPrimitive(primitive);
  doc.createScene('scene').addChild(doc.createNode('unreadable-node').setMesh(mesh));
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
    .writeBinary(doc);
}

const MASTER_GLB = await buildMasterGlb();
const WEB_GLB = await buildWebGlb();

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
    expect(html).toContain('not standing on its base');
    expect(html).toContain('data-lighting="studio" aria-pressed="true"');
    expect(html).toContain('data-directional-environment="data:image/png;base64,');
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
      new RegExp(
        `web/chest\\.web\\.glb is ${WEB_GLB.byteLength + 1} bytes in the zip, but manifest\\.json says ${WEB_GLB.byteLength}`
      )
    );
    await expect(readFile(join(dir, `${BASE}.html`))).rejects.toThrow(/ENOENT/);
  });

  it('rebuilds with a checks note when the master cannot be analysed', async () => {
    const dir = await createDir();
    const master = await buildUnreadableMasterGlb();
    const manifest = {
      ...MANIFEST,
      variants: [{ ...MANIFEST.variants[0], bytes: master.byteLength }, MANIFEST.variants[1]],
    };
    const zipPath = join(dir, ZIP_NAME);
    await writeFile(
      zipPath,
      zipPackage([
        { path: 'chest.glb', bytes: master },
        { path: 'web/chest.web.glb', bytes: WEB_GLB },
        {
          path: 'manifest.json',
          bytes: new TextEncoder().encode(JSON.stringify(manifest)),
        },
      ])
    );

    const htmlPath = await rebuildPreviewFromZip(zipPath, { force: false });

    const html = await readFile(htmlPath, 'utf8');
    expect(html).toContain('Checks unavailable:');
  });

  it('fails on an existing preview before opening the zip', async () => {
    const dir = await createDir();
    const htmlPath = join(dir, `${BASE}.html`);
    await writeFile(htmlPath, 'keep me', 'utf8');

    await expect(rebuildPreviewFromZip(join(dir, `${BASE}.zip`), { force: false })).rejects.toThrow(
      /Preview already exists/
    );
    expect(await readFile(htmlPath, 'utf8')).toBe('keep me');
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
