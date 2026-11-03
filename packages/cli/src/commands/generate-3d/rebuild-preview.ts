/**
 * Generate 3D — rebuild the standalone preview from an existing package zip.
 *
 * The package already holds everything the page needs: `manifest.json` and both
 * GLBs (the master at `<stem>.glb`, the web variant at `web/<stem>.web.glb`).
 * This path is deliberately local and offline: it never reads `FAL_API_KEY`,
 * never imports the fal client, and never touches the network. It reuses
 * `renderPreviewHtml`, so a rebuilt page is the same document the generator
 * writes; only the text in `manifest.json` differs.
 *
 * The zip is validated in full before anything is written: a missing manifest,
 * a missing GLB, or a byte length that disagrees with the manifest is an error,
 * not a half-built page beside the archive.
 */

import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { unzipSync } from 'fflate';
import { MeshoptDecoder } from 'meshoptimizer';

import { analyseDocument } from './asset-analysis.js';
import { computeChecks, type AssetCheck } from './checks.js';
import { directionalEnvironmentPng, renderPreviewHtml } from './preview-html.js';
import type { PathStatus } from '../image-shared/output-files.js';
import { findUnwritablePathMessage } from '../image-shared/writable-path.js';

/** File name of the package manifest inside the zip; matches the writer. */
const PACKAGE_MANIFEST_NAME = 'manifest.json';

/** The parts of one `manifest.json` variant the preview consumes. */
interface ManifestVariant {
  name: string;
  file: string;
  bytes: number;
  triangles: number;
  sha256: string;
}

/** The parts of `manifest.json` the preview consumes. */
interface PreviewManifest {
  model: string;
  requestId: string;
  prompt: string | null;
  master: ManifestVariant;
  web: ManifestVariant;
}

/** The zip entries and the manifest fields the page needs. */
interface PackageContents {
  manifest: PreviewManifest;
  masterGlb: Uint8Array;
  webGlb: Uint8Array;
}

export interface RebuildPreviewOptions {
  /** Replace an existing `<base>.html` beside the zip. */
  force: boolean;
}

/** A plain object, not an array or null. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One consistent prefix for every validation failure. */
function invalidPackage(zipPath: string, detail: string): Error {
  return new Error(`Cannot rebuild the preview from ${zipPath}: ${detail}`);
}

/** A non-empty string field, with the field named in the failure. */
function requireString(record: Record<string, unknown>, field: string, zipPath: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidPackage(zipPath, `manifest.json has no ${field}.`);
  }
  return value;
}

/** A non-negative integer field, with the field named in the failure. */
function requireCount(record: Record<string, unknown>, field: string, zipPath: string): number {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw invalidPackage(zipPath, `manifest.json has no valid ${field}.`);
  }
  return value;
}

/** A nested object field, with the field named in the failure. */
function requireRecord(
  record: Record<string, unknown>,
  field: string,
  zipPath: string
): Record<string, unknown> {
  const value = record[field];
  if (!isRecord(value)) {
    throw invalidPackage(zipPath, `manifest.json has no ${field} object.`);
  }
  return value;
}

/** `generator.prompt` is a string when asked for, and null for an image input. */
function readPrompt(generator: Record<string, unknown>, zipPath: string): string | null {
  const prompt = generator.prompt;
  if (prompt === null || typeof prompt === 'string') return prompt;
  throw invalidPackage(zipPath, 'manifest.json has no valid generator.prompt.');
}

/** Find and validate one named variant (`master` or `web`). */
function requireVariant(
  variants: unknown[],
  name: 'master' | 'web',
  zipPath: string
): ManifestVariant {
  const match = variants.find((variant) => isRecord(variant) && variant.name === name);
  if (!isRecord(match)) {
    throw invalidPackage(zipPath, `manifest.json has no "${name}" variant.`);
  }
  return {
    name,
    file: requireString(match, 'file', zipPath),
    bytes: requireCount(match, 'bytes', zipPath),
    triangles: requireCount(match, 'triangles', zipPath),
    sha256: requireString(match, 'sha256', zipPath),
  };
}

/** Parse and validate the manifest; every field the page renders is checked. */
function parseManifest(bytes: Uint8Array, zipPath: string): PreviewManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw invalidPackage(zipPath, 'manifest.json is not valid JSON.');
  }
  if (!isRecord(raw)) {
    throw invalidPackage(zipPath, 'manifest.json is not an object.');
  }
  const generator = requireRecord(raw, 'generator', zipPath);
  const variants = raw.variants;
  if (!Array.isArray(variants)) {
    throw invalidPackage(zipPath, 'manifest.json has no variants array.');
  }
  return {
    model: requireString(generator, 'model', zipPath),
    requestId: requireString(generator, 'requestId', zipPath),
    prompt: readPrompt(generator, zipPath),
    master: requireVariant(variants, 'master', zipPath),
    web: requireVariant(variants, 'web', zipPath),
  };
}

/** The zip entry named by the manifest, with its length checked. */
function requireEntry(
  files: Record<string, Uint8Array>,
  variant: ManifestVariant,
  role: string,
  zipPath: string
): Uint8Array {
  const bytes = files[variant.file];
  if (bytes === undefined) {
    throw invalidPackage(zipPath, `the ${role} GLB ${variant.file} is missing from the zip.`);
  }
  if (bytes.byteLength !== variant.bytes) {
    throw invalidPackage(
      zipPath,
      `${variant.file} is ${bytes.byteLength} bytes in the zip, but manifest.json says ${variant.bytes}.`
    );
  }
  return bytes;
}

/** Unpack the zip in memory; nothing is extracted beside the zip. */
async function readArchive(zipPath: string): Promise<Record<string, Uint8Array>> {
  const archive = await readFile(zipPath).catch((err: unknown) => {
    throw new Error(
      `Cannot read the package ${zipPath}: ${err instanceof Error ? err.message : String(err)}`
    );
  });
  try {
    return unzipSync(archive);
  } catch (err) {
    throw invalidPackage(
      zipPath,
      `not a readable zip archive (${err instanceof Error ? err.message : String(err)}).`
    );
  }
}

/** Validate the archive's manifest and both GLBs against their recorded sizes. */
function loadPackage(zipPath: string, files: Record<string, Uint8Array>): PackageContents {
  const manifestBytes = files[PACKAGE_MANIFEST_NAME];
  if (manifestBytes === undefined) {
    throw invalidPackage(zipPath, `${PACKAGE_MANIFEST_NAME} is missing from the zip.`);
  }
  const manifest = parseManifest(manifestBytes, zipPath);
  return {
    manifest,
    masterGlb: requireEntry(files, manifest.master, 'master', zipPath),
    webGlb: requireEntry(files, manifest.web, 'web', zipPath),
  };
}

/** The `<base>` of `<base>.zip`, or a clear error for another extension. */
function packageBase(zipName: string, zipPath: string): string {
  if (!zipName.endsWith('.zip') || zipName.length === '.zip'.length) {
    throw invalidPackage(zipPath, 'the package must be a non-empty .zip file.');
  }
  return zipName.slice(0, -'.zip'.length);
}

/**
 * `stat`-based classification that treats an unreadable path as free, as this
 * command did before the shared preflight existed.
 */
async function previewPathStatus(path: string): Promise<PathStatus> {
  const stats = await stat(path).catch(() => null);
  if (stats === null) return 'missing';
  return stats.isDirectory() ? 'directory' : 'file';
}

/** Refuse to clobber a file or a directory unless `--force` was passed. */
async function requireWritablePreview(htmlPath: string, force: boolean): Promise<void> {
  const message = await findUnwritablePathMessage(
    { pathStatus: previewPathStatus },
    [{ path: htmlPath, label: 'Preview' }],
    force
  );
  if (message !== null) throw new Error(message);
}

/** Render and write the page; exclusive unless `--force` was passed. */
async function writePreview(htmlPath: string, html: string, force: boolean): Promise<void> {
  await requireWritablePreview(htmlPath, force);
  try {
    await writeFile(htmlPath, new TextEncoder().encode(html), { flag: force ? 'w' : 'wx' });
  } catch (err) {
    throw new Error(
      `Cannot write the preview ${htmlPath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Rebuild `<base>.html` beside the zip and return its path.
 *
 * The page embeds both variants, so the zip is not consulted again after the
 * rebuild; the archive can be moved or deleted and the page still opens.
 */
export async function rebuildPreviewFromZip(
  zipPath: string,
  options: RebuildPreviewOptions
): Promise<string> {
  const zipName = basename(zipPath);
  const base = packageBase(zipName, zipPath);
  const htmlPath = join(dirname(zipPath), `${base}.html`);
  // Fail fast on a collision, before opening or analysing the archive.
  await requireWritablePreview(htmlPath, options.force);
  const { manifest, masterGlb, webGlb } = loadPackage(zipPath, await readArchive(zipPath));

  let checks: AssetCheck[] = [];
  let checksNote: string | null = null;
  try {
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    checks = computeChecks(await analyseDocument(await io.readBinary(masterGlb)));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    checksNote = `Checks unavailable: ${detail}`;
  }
  const directionalEnvironment = await directionalEnvironmentPng();

  const html = renderPreviewHtml({
    title: base,
    modelId: manifest.model,
    prompt: manifest.prompt,
    requestId: manifest.requestId,
    masterGlb,
    webGlb,
    webSha256: manifest.web.sha256,
    webTriangles: manifest.web.triangles,
    masterTriangles: manifest.master.triangles,
    masterBytes: manifest.master.bytes,
    webBytes: manifest.web.bytes,
    masterZipEntry: manifest.master.file,
    zipName,
    checks,
    checksNote,
    directionalEnvironmentPng: directionalEnvironment,
  });

  await writePreview(htmlPath, html, options.force);
  return htmlPath;
}
