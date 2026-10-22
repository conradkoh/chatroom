/**
 * Slice Image — pure logic for `chatroom slice-image`.
 *
 * Cuts one PNG sprite sheet into a regular grid of named tiles. No filesystem,
 * PNG codec, clock, or network access is imported here; all of it arrives
 * through `SliceImageDeps`, so the unit tests run fully offline and the disk is
 * untouched until every validation, decode, crop, and encode step has passed.
 */

// The constants and manifest types are part of the public slice API (tests and
// future callers import them), and sliceImage is a linear 10-step pipeline.
// fallow-ignore-file unused-export complexity

import { createHash } from 'node:crypto';
import { basename, extname, join, resolve } from 'node:path';

import type { SliceImageDeps } from './slice-deps.js';

export const SLICE_TOOL = 'chatroom slice-image' as const;
export const MAX_TILES = 256;
export const MAX_GRID_DIMENSION = 64;
export const MAX_SOURCE_PIXELS = 100_000_000;
export const MAX_SOURCE_BYTES = 64 * 1024 * 1024;

/** PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A. */
const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** fal's terms do not grant verified commercial rights, so tiles stay unverified. */
const LICENSING = 'unverified' as const;

export class SliceImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SliceImageError';
  }
}

export interface SliceImageOptions {
  in: string;
  outDir: string;
  cols: number;
  rows: number;
  /** Pixels skipped on all four sides of the sheet; default 0. */
  margin?: number | undefined;
  /** Pixels between adjacent cells on both axes; default 0. */
  gutter?: number | undefined;
  /** Exactly cols*rows entries, row-major. An empty entry skips that cell. */
  names?: string[] | undefined;
  /** Output stem prefix when `names` is absent; defaults to the sheet file stem. */
  prefix?: string | undefined;
  allowRemainder?: boolean | undefined;
  force?: boolean | undefined;
  dryRun?: boolean | undefined;
}

export interface SliceTile {
  /** 0-based, row-major. */
  index: number;
  row: number;
  col: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Output stem, no extension. */
  name: string;
}

export interface SliceGrid {
  tileWidth: number;
  tileHeight: number;
  droppedRight: number;
  droppedBottom: number;
  cells: Pick<SliceTile, 'index' | 'row' | 'col' | 'x' | 'y' | 'width' | 'height'>[];
}

export interface SliceImageResult {
  dryRun: boolean;
  sheet: { path: string; sha256: string; width: number; height: number };
  tileSize: { width: number; height: number };
  droppedRemainder: { right: number; bottom: number };
  outDir: string;
  /** sha256 is always the real hash of the encoded tile, even under `dryRun`. */
  tiles: (SliceTile & { path: string; manifestPath: string; sha256: string })[];
  /** 0-based indexes of skipped cells. */
  skipped: number[];
  indexPath: string;
  warnings: string[];
}

/** The subset of a `generate-image` manifest copied into a tile manifest. */
export interface SliceSourceManifest {
  platform: unknown;
  model: unknown;
  requestId: unknown;
  seed: unknown;
  generatedAt: unknown;
  outputSha256: string | null;
  sha256Matches: boolean | null;
}

export interface SliceSourceInfo {
  path: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  manifestPath: string | null;
  manifest: SliceSourceManifest | null;
}

export interface SliceTileManifest {
  tool: typeof SLICE_TOOL;
  decoder: string;
  source: SliceSourceInfo;
  grid: {
    cols: number;
    rows: number;
    margin: number;
    gutter: number;
    row: number;
    col: number;
    index: number;
  };
  crop: { x: number; y: number; width: number; height: number };
  output: {
    path: string;
    sha256: string;
    contentType: 'image/png';
    bytes: number;
    width: number;
    height: number;
    hasAlpha: boolean;
  };
  slicedAt: string;
  licensing: typeof LICENSING;
}

export interface SliceIndexManifest {
  tool: typeof SLICE_TOOL;
  decoder: string;
  source: SliceSourceInfo;
  grid: {
    cols: number;
    rows: number;
    margin: number;
    gutter: number;
    tileWidth: number;
    tileHeight: number;
    droppedRight: number;
    droppedBottom: number;
  };
  tiles: {
    index: number;
    row: number;
    col: number;
    name: string;
    path: string;
    manifestPath: string;
    sha256: string;
  }[];
  skipped: number[];
  slicedAt: string;
  licensing: typeof LICENSING;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The next power-of-two digit width, with a floor of two digits. */
function padWidth(tileCount: number): number {
  return Math.max(2, String(tileCount).length);
}

function requireInteger(value: number, label: string, min: number, max?: number): number {
  if (!Number.isInteger(value)) {
    throw new SliceImageError(`${label} must be an integer.`);
  }
  if (value < min || (max !== undefined && value > max)) {
    const range = max === undefined ? `at least ${min}` : `between ${min} and ${max}`;
    throw new SliceImageError(`${label} must be ${range}.`);
  }
  return value;
}

function requireNonEmptyPath(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new SliceImageError(`${label} must not be empty.`);
  }
  return trimmed;
}

/**
 * Resolve the grid geometry without touching pixels.
 *
 * Cells are row-major. Remainder pixels stay unused on the right and bottom,
 * and are reported rather than spread across tiles, so every tile is exactly
 * `tileWidth x tileHeight` with no resampling or padding.
 */
export function computeSliceGrid(args: {
  width: number;
  height: number;
  cols: number;
  rows: number;
  margin: number;
  gutter: number;
  allowRemainder: boolean;
}): SliceGrid {
  const { width, height, cols, rows, margin, gutter, allowRemainder } = args;

  const usableW = width - 2 * margin - gutter * (cols - 1);
  const usableH = height - 2 * margin - gutter * (rows - 1);
  if (usableW < cols || usableH < rows) {
    throw new SliceImageError(
      `grid does not fit: ${width}x${height} with margin ${margin} and gutter ${gutter} leaves ${usableW}x${usableH} usable pixels, which is too small for ${cols} cols x ${rows} rows.`
    );
  }

  const tileWidth = Math.floor(usableW / cols);
  const tileHeight = Math.floor(usableH / rows);
  const droppedRight = usableW % cols;
  const droppedBottom = usableH % rows;

  if ((droppedRight > 0 || droppedBottom > 0) && !allowRemainder) {
    throw new SliceImageError(
      `Sheet ${width}x${height} does not divide into ${cols} cols x ${rows} rows (width remainder ${droppedRight}px, height remainder ${droppedBottom}px). Use a grid that divides evenly, or pass --allow-remainder to drop the leftover pixels on the right/bottom.`
    );
  }

  const cells: SliceGrid['cells'] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      cells.push({
        index: row * cols + col,
        row,
        col,
        x: margin + col * (tileWidth + gutter),
        y: margin + row * (tileHeight + gutter),
        width: tileWidth,
        height: tileHeight,
      });
    }
  }

  return { tileWidth, tileHeight, droppedRight, droppedBottom, cells };
}

const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;

/**
 * Resolve one output stem per cell, row-major.
 *
 * An empty string skips that cell. Explicit names are validated before any
 * work so a name cannot escape `--out-dir`. Default names are `<prefix>-NN`.
 */
export function resolveTileNames(args: {
  cols: number;
  rows: number;
  names?: string[] | undefined;
  prefix: string;
}): string[] {
  const { cols, rows, names } = args;
  const expected = cols * rows;

  if (names === undefined) {
    const prefix = args.prefix.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    if (prefix.length === 0) {
      throw new SliceImageError(
        '--prefix is empty after sanitising; pass --prefix with letters, digits, "_" or "-".'
      );
    }
    const width = padWidth(expected);
    return Array.from({ length: expected }, (_, index) => {
      const padded = String(index + 1).padStart(width, '0');
      return `${prefix}-${padded}`;
    });
  }

  if (names.length !== expected) {
    throw new SliceImageError(
      `--names must have exactly ${expected} entries for a ${cols}x${rows} grid (got ${names.length}).`
    );
  }

  const seen = new Map<string, number>();
  let active = 0;
  for (const [index, raw] of names.entries()) {
    const name = raw.trim();
    if (name.length === 0) continue;
    if (!SAFE_NAME.test(name)) {
      throw new SliceImageError(
        `--names entry ${index + 1} ("${raw}") is not a safe file name. Use letters, digits, "_" or "-" (max 64 characters, starting with a letter, digit, or "_").`
      );
    }
    const key = name.toLowerCase();
    const previous = seen.get(key);
    if (previous !== undefined) {
      throw new SliceImageError(
        `--names contains duplicate "${key}" at entries ${previous + 1} and ${index + 1} (names are compared case-insensitively).`
      );
    }
    seen.set(key, index);
    active += 1;
  }

  if (active === 0) {
    throw new SliceImageError('--names must contain at least one non-empty name.');
  }

  return names.map((name) => name.trim());
}

function hasPngMagic(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_MAGIC.length) return false;
  return PNG_MAGIC.every((byte, index) => bytes[index] === byte);
}

/** Copy one tile out of the RGBA source. No scaling, padding, or trimming. */
function cropTile(
  image: { width: number; height: number; data: Uint8Array },
  cell: Pick<SliceTile, 'x' | 'y' | 'width' | 'height'>
): { width: number; height: number; data: Uint8Array } {
  const rowBytes = cell.width * 4;
  const data = new Uint8Array(rowBytes * cell.height);
  for (let row = 0; row < cell.height; row += 1) {
    const sourceStart = ((cell.y + row) * image.width + cell.x) * 4;
    data.set(image.data.subarray(sourceStart, sourceStart + rowBytes), row * rowBytes);
  }
  return { width: cell.width, height: cell.height, data };
}

function hasAlpha(data: Uint8Array): boolean {
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] !== 255) return true;
  }
  return false;
}

interface ParsedSourceManifest {
  manifest: SliceSourceManifest | null;
  warnings: string[];
}

/**
 * Copy the provenance fields we understand from the generate-image sidecar.
 * Unknown or malformed shapes are ignored with a warning; they must not stop a
 * local, free slice.
 */
function parseSourceManifest(
  raw: unknown,
  sheetSha: string,
  manifestPath: string
): ParsedSourceManifest {
  if (!isRecord(raw)) {
    return {
      manifest: null,
      warnings: [`Ignoring ${manifestPath}: it is not a JSON object.`],
    };
  }

  const output = isRecord(raw.output) ? raw.output : undefined;
  const outputSha256 = typeof output?.sha256 === 'string' ? output.sha256 : null;
  const sha256Matches = outputSha256 === null ? null : outputSha256 === sheetSha;
  const warnings: string[] = [];
  if (sha256Matches === false) {
    warnings.push(
      `Source manifest records output.sha256 ${outputSha256}, which does not match the sheet (${sheetSha}); the sheet may have been edited after generation.`
    );
  }

  return {
    manifest: {
      platform: raw.platform,
      model: raw.model,
      requestId: raw.requestId,
      seed: raw.seed,
      generatedAt: raw.generatedAt,
      outputSha256,
      sha256Matches,
    },
    warnings,
  };
}

interface OutputConflict {
  path: string;
  reason: string;
}

/** Format every conflict at once, capped so one noisy directory stays readable. */
function formatConflicts(conflicts: OutputConflict[]): string {
  const shown = conflicts.slice(0, 10);
  const lines = shown.map((conflict) => `- ${conflict.path}: ${conflict.reason}`);
  if (conflicts.length > shown.length) {
    lines.push(`- and ${conflicts.length - shown.length} more`);
  }
  return `Refusing to write ${conflicts.length} output file(s):\n${lines.join('\n')}\nPass --force to overwrite.`;
}

/**
 * Preflight every output path before any write. Directories and paths that
 * collide with the source sheet or its manifest are always refused; existing
 * files are refused unless `--force` was passed.
 */
async function preflightOutputs(
  deps: SliceImageDeps,
  paths: string[],
  sourcePaths: ReadonlySet<string>,
  force: boolean
): Promise<void> {
  const conflicts: OutputConflict[] = [];
  for (const path of paths) {
    if (sourcePaths.has(path)) {
      conflicts.push({ path, reason: 'this is the source sheet or its manifest' });
      continue;
    }
    const status = await deps.pathStatus(path);
    if (status === 'directory') {
      conflicts.push({ path, reason: 'a directory is in the way' });
    } else if (status === 'file' && !force) {
      conflicts.push({ path, reason: 'already exists' });
    }
  }
  if (conflicts.length > 0) {
    throw new SliceImageError(formatConflicts(conflicts));
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function sliceImage(
  opts: SliceImageOptions,
  deps: SliceImageDeps
): Promise<SliceImageResult> {
  // 1. Validate options before touching the filesystem.
  const cols = requireInteger(opts.cols, '--cols', 1, MAX_GRID_DIMENSION);
  const rows = requireInteger(opts.rows, '--rows', 1, MAX_GRID_DIMENSION);
  if (cols * rows > MAX_TILES) {
    throw new SliceImageError(
      `--cols ${cols} x --rows ${rows} produces ${cols * rows} tiles; the maximum is ${MAX_TILES}.`
    );
  }
  const margin = requireInteger(opts.margin ?? 0, '--margin', 0);
  const gutter = requireInteger(opts.gutter ?? 0, '--gutter', 0);
  if (opts.names !== undefined && opts.prefix !== undefined) {
    throw new SliceImageError('--names and --prefix are mutually exclusive.');
  }
  const inPath = resolve(requireNonEmptyPath(opts.in, '--in'));
  const outDir = resolve(requireNonEmptyPath(opts.outDir, '--out-dir'));
  const force = opts.force === true;
  const dryRun = opts.dryRun === true;

  // 2. The source must be a file, not a directory or a missing path.
  const status = await deps.pathStatus(inPath);
  if (status === 'missing') {
    throw new SliceImageError(`--in not found: ${inPath}`);
  }
  if (status === 'directory') {
    throw new SliceImageError(`--in is a directory: ${inPath}. Pass a PNG file path.`);
  }

  // 3. Read and size-check the sheet, then prove it is a PNG before decoding.
  const bytes = await deps.readFile(inPath);
  if (bytes.byteLength > MAX_SOURCE_BYTES) {
    throw new SliceImageError(
      `--in is ${bytes.byteLength} bytes; the maximum is ${MAX_SOURCE_BYTES} bytes (64 MiB).`
    );
  }
  if (!hasPngMagic(bytes)) {
    throw new SliceImageError(
      "--in is not a PNG. slice-image only reads PNG sheets; regenerate with 'chatroom generate-image --output-format png' (the default model returns PNG)."
    );
  }

  // 4. Decode in memory. A malformed PNG is a clear input error.
  let image: { width: number; height: number; data: Uint8Array };
  try {
    image = deps.decodePng(bytes);
  } catch (err) {
    throw new SliceImageError(`Could not decode --in as PNG: ${errorMessage(err)}`);
  }
  if (image.width * image.height > MAX_SOURCE_PIXELS) {
    throw new SliceImageError(
      `--in is ${image.width}x${image.height} (${image.width * image.height} pixels); the maximum is ${MAX_SOURCE_PIXELS} pixels.`
    );
  }
  const sheetSha = sha256(bytes);

  // 5. Geometry, names, and every output path.
  const grid = computeSliceGrid({
    width: image.width,
    height: image.height,
    cols,
    rows,
    margin,
    gutter,
    allowRemainder: opts.allowRemainder === true,
  });
  const sheetStem = basename(inPath, extname(inPath));
  const names = resolveTileNames({
    cols,
    rows,
    names: opts.names,
    prefix: opts.prefix ?? sheetStem,
  });
  const indexPath = join(outDir, `${sheetStem}.slices.json`);
  const sourceManifestPath = `${inPath}.json`;
  const outputs = grid.cells
    .map((cell) => {
      const name = names[cell.index] ?? '';
      if (name.length === 0) return null;
      const path = join(outDir, `${name}.png`);
      return { cell, name, path, manifestPath: `${path}.json` };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const skipped = grid.cells
    .filter((cell) => (names[cell.index] ?? '').length === 0)
    .map((cell) => cell.index);

  // 6. Read the optional generate-image sidecar. It never blocks a slice.
  const warnings: string[] = [];
  if (grid.droppedRight > 0 || grid.droppedBottom > 0) {
    warnings.push(
      `Dropped ${grid.droppedRight}px on the right and ${grid.droppedBottom}px at the bottom to fit the ${cols}x${rows} grid.`
    );
  }

  let sourceManifest: SliceSourceManifest | null = null;
  try {
    const rawManifest = await deps.readJsonIfExists(sourceManifestPath);
    if (rawManifest === undefined) {
      warnings.push(
        `No generate-image manifest at ${sourceManifestPath}; tile manifests record the sheet hash only.`
      );
    } else {
      const parsed = parseSourceManifest(rawManifest, sheetSha, sourceManifestPath);
      sourceManifest = parsed.manifest;
      warnings.push(...parsed.warnings);
    }
  } catch (err) {
    warnings.push(`Ignoring ${sourceManifestPath}: ${errorMessage(err)}`);
  }
  const source: SliceSourceInfo = {
    path: inPath,
    sha256: sheetSha,
    bytes: bytes.byteLength,
    width: image.width,
    height: image.height,
    manifestPath: sourceManifest === null ? null : sourceManifestPath,
    manifest: sourceManifest,
  };

  // 7. Refuse every unwritable output before a single byte is written.
  const allOutputPaths = [
    ...outputs.flatMap((output) => [output.path, output.manifestPath]),
    indexPath,
  ];
  await preflightOutputs(deps, allOutputPaths, new Set([inPath, sourceManifestPath]), force);

  // 8. Crop and encode everything in memory. Any failure leaves the disk alone.
  const encoded = outputs.map((output) => {
    const cropped = cropTile(image, output.cell);
    let encodedBytes: Uint8Array;
    try {
      encodedBytes = deps.encodePng(cropped);
    } catch (err) {
      throw new SliceImageError(`Could not encode tile ${output.name}: ${errorMessage(err)}`);
    }
    return {
      ...output,
      encodedBytes,
      sha256: sha256(encodedBytes),
      hasAlpha: hasAlpha(cropped.data),
    };
  });

  const resultTiles = encoded.map(({ cell, name, path, manifestPath, sha256: tileSha }) => ({
    ...cell,
    name,
    path,
    manifestPath,
    sha256: tileSha,
  }));

  const result: SliceImageResult = {
    dryRun,
    sheet: { path: inPath, sha256: sheetSha, width: image.width, height: image.height },
    tileSize: { width: grid.tileWidth, height: grid.tileHeight },
    droppedRemainder: { right: grid.droppedRight, bottom: grid.droppedBottom },
    outDir,
    tiles: resultTiles,
    skipped,
    indexPath,
    warnings,
  };

  // 9. A dry run reports exactly what would happen, but creates nothing.
  if (dryRun) return result;

  // 10. Write tiles in index order, then the sheet index last.
  await deps.ensureDir(outDir);
  const slicedAt = deps.now().toISOString();
  const decoder = `pngjs@${deps.decoderVersion}`;
  const written: string[] = [];

  const write = async (path: string, action: () => Promise<void>): Promise<void> => {
    try {
      await action();
      written.push(path);
    } catch (err) {
      throw new SliceImageError(
        `Failed to write ${path}: ${errorMessage(err)}. Already written: ${written.length > 0 ? written.join(', ') : 'none'}. Re-run with --force after fixing the cause.`
      );
    }
  };

  for (const tile of encoded) {
    const manifest: SliceTileManifest = {
      tool: SLICE_TOOL,
      decoder,
      source,
      grid: {
        cols,
        rows,
        margin,
        gutter,
        row: tile.cell.row,
        col: tile.cell.col,
        index: tile.cell.index,
      },
      crop: {
        x: tile.cell.x,
        y: tile.cell.y,
        width: tile.cell.width,
        height: tile.cell.height,
      },
      output: {
        path: tile.path,
        sha256: tile.sha256,
        contentType: 'image/png',
        bytes: tile.encodedBytes.byteLength,
        width: tile.cell.width,
        height: tile.cell.height,
        hasAlpha: tile.hasAlpha,
      },
      slicedAt,
      licensing: LICENSING,
    };
    await write(tile.path, () => deps.writeFile(tile.path, tile.encodedBytes));
    await write(tile.manifestPath, () => deps.writeJson(tile.manifestPath, manifest));
  }

  const index: SliceIndexManifest = {
    tool: SLICE_TOOL,
    decoder,
    source,
    grid: {
      cols,
      rows,
      margin,
      gutter,
      tileWidth: grid.tileWidth,
      tileHeight: grid.tileHeight,
      droppedRight: grid.droppedRight,
      droppedBottom: grid.droppedBottom,
    },
    tiles: resultTiles.map((tile) => ({
      index: tile.index,
      row: tile.row,
      col: tile.col,
      name: tile.name,
      path: tile.path,
      manifestPath: tile.manifestPath,
      sha256: tile.sha256,
    })),
    skipped,
    slicedAt,
    licensing: LICENSING,
  };
  await write(indexPath, () => deps.writeJson(indexPath, index));

  return result;
}
