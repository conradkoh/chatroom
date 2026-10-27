/**
 * Slice Image — pure logic for `chatroom slice-image`.
 *
 * Cuts one PNG sprite sheet into a regular grid of named tiles. No filesystem,
 * PNG codec, clock, or network access is imported here; all of it arrives
 * through `SliceImageDeps`, so the unit tests run fully offline and the disk is
 * untouched until every validation, decode, crop, and encode step has passed.
 */

import { basename, extname, join, resolve } from 'node:path';

import type { FileIdentity, SliceImageDeps } from './slice-deps.js';
import {
  MAX_SOURCE_BYTES,
  MAX_SOURCE_PIXELS,
  MAX_SIDECAR_BYTES,
  SAFE_NAME,
  errorMessage,
  findOutputConflicts,
  formatConflicts,
  hasPngMagic,
  isRecord,
  median,
  readPngDimensions,
  sha256,
} from '../image-shared/local-image-common.js';

const SLICE_TOOL = 'chatroom slice-image' as const;
const MAX_TILES = 256;
export const MAX_GRID_DIMENSION = 64;

/** fal's terms do not grant verified commercial rights, so tiles stay unverified. */
const LICENSING = 'unverified' as const;

// fallow-ignore-next-line unused-export
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
  /** Skip the check that refuses sheets whose artwork crosses cell borders. */
  allowEdgeContent?: boolean | undefined;
  force?: boolean | undefined;
  dryRun?: boolean | undefined;
}

interface SliceTile {
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

interface SliceGrid {
  tileWidth: number;
  tileHeight: number;
  droppedRight: number;
  droppedBottom: number;
  cells: Pick<SliceTile, 'index' | 'row' | 'col' | 'x' | 'y' | 'width' | 'height'>[];
}

interface SliceImageResult {
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
interface SliceSourceManifest {
  platform: unknown;
  model: unknown;
  requestId: unknown;
  seed: unknown;
  generatedAt: unknown;
  outputSha256: string | null;
  sha256Matches: boolean | null;
}

interface SliceSourceInfo {
  path: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  manifestPath: string | null;
  manifest: SliceSourceManifest | null;
}

interface SliceTileManifest {
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

interface SliceIndexManifest {
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

/** Zero-pad width: decimal digits in the tile count, with a floor of two. */
function padWidth(tileCount: number): number {
  return Math.max(2, String(tileCount).length);
}

// fallow-ignore-next-line complexity
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
// fallow-ignore-next-line unused-export complexity
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

/** Longest output path component we allow: `<name>.slices.json`. */
const MAX_OUTPUT_NAME_LENGTH = 200;

function requireOutputNameFits(name: string): string {
  const longest = `${name}.slices.json`;
  if (longest.length > MAX_OUTPUT_NAME_LENGTH) {
    throw new SliceImageError(
      `Output name "${longest}" is ${longest.length} characters; the maximum is ${MAX_OUTPUT_NAME_LENGTH}. Use a shorter --prefix.`
    );
  }
  return name;
}

/**
 * Resolve one output stem per cell, row-major.
 *
 * An empty string skips that cell. Explicit names are validated before any
 * work so a name cannot escape `--out-dir`. Default names are `<prefix>-NN`.
 */
// fallow-ignore-next-line unused-export complexity
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
      return requireOutputNameFits(`${prefix}-${padded}`);
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

  return names.map((name) => {
    const trimmed = name.trim();
    return trimmed.length === 0 ? '' : requireOutputNameFits(trimmed);
  });
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
// fallow-ignore-next-line complexity
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

/**
 * Preflight every output path before any write. Directories, symbolic links,
 * paths that resolve to the source sheet or its manifest, and existing files
 * without `--force` are all refused. Identity checks use `stat`, so a case
 * variant, hard link, or symlinked directory cannot overwrite the source.
 */
async function preflightOutputs(
  deps: SliceImageDeps,
  paths: string[],
  sourcePaths: ReadonlySet<string>,
  sourceIdentities: readonly (FileIdentity | null)[],
  force: boolean
): Promise<void> {
  const conflicts = await findOutputConflicts(deps, paths, sourcePaths, sourceIdentities, force);
  if (conflicts.length > 0) {
    throw new SliceImageError(formatConflicts(conflicts));
  }
}

/** Any channel differing by more than this counts as artwork, not background. */
const EDGE_CONTENT_THRESHOLD = 25;
/** Noise tolerated on each individual cell edge before it counts as artwork. */
const MAX_EDGE_CONTENT_PIXELS_PER_EDGE = 1;
/** The error names at most this many offending cells. */
const MAX_REPORTED_EDGE_CELLS = 10;

type Rgb = [number, number, number];

interface EdgeCounts {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Per-channel median of the opaque colours on the sheet's outer 1-px border. */
// fallow-ignore-next-line complexity
function mostFrequentBorderColor(image: {
  width: number;
  height: number;
  data: Uint8Array;
}): Rgb | null {
  const { width, height, data } = image;
  const red: number[] = [];
  const green: number[] = [];
  const blue: number[] = [];
  // fallow-ignore-next-line complexity
  const add = (x: number, y: number): void => {
    const offset = (y * width + x) * 4;
    if (data[offset + 3] === 0) return;
    red.push(data[offset] ?? 0);
    green.push(data[offset + 1] ?? 0);
    blue.push(data[offset + 2] ?? 0);
  };
  for (let x = 0; x < width; x += 1) {
    add(x, 0);
    if (height > 1) add(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    add(0, y);
    if (width > 1) add(width - 1, y);
  }
  if (red.length === 0) return null;
  return [median(red), median(green), median(blue)];
}

/**
 * Count foreground pixels on one cell's border. The sheet's own outer border is
 * excluded: it is where the background estimate came from and is not a cell
 * boundary between two items.
 */
// fallow-ignore-next-line complexity
function countCellEdgeForeground(
  image: { width: number; height: number; data: Uint8Array },
  cell: { x: number; y: number; width: number; height: number },
  background: Rgb
): EdgeCounts {
  const { width, height, data } = image;
  // fallow-ignore-next-line complexity
  const isForeground = (x: number, y: number): boolean => {
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return false;
    const offset = (y * width + x) * 4;
    if ((data[offset + 3] ?? 0) === 0) return false;
    const red = data[offset] ?? 0;
    const green = data[offset + 1] ?? 0;
    const blue = data[offset + 2] ?? 0;
    const difference = Math.max(
      Math.abs(red - background[0]),
      Math.abs(green - background[1]),
      Math.abs(blue - background[2])
    );
    return difference > EDGE_CONTENT_THRESHOLD;
  };

  const lastX = cell.x + cell.width - 1;
  const lastY = cell.y + cell.height - 1;
  const counts: EdgeCounts = { top: 0, bottom: 0, left: 0, right: 0 };
  for (let x = cell.x; x <= lastX; x += 1) {
    if (isForeground(x, cell.y)) counts.top += 1;
    if (isForeground(x, lastY)) counts.bottom += 1;
  }
  for (let y = cell.y; y <= lastY; y += 1) {
    if (isForeground(cell.x, y)) counts.left += 1;
    if (isForeground(lastX, y)) counts.right += 1;
  }
  return counts;
}

/**
 * Refuse sheets whose artwork touches an internal cell border.
 *
 * A generated sheet that does not match an equal-cell grid is cut through its
 * artwork; this check turns that silent damage into a clear refusal. Faint
 * drawn separators stay below the colour threshold, and a genuinely
 * full-bleed/tileable sheet can opt out with `--allow-edge-content`.
 */
// fallow-ignore-next-line complexity
function requireNoEdgeContent(args: {
  image: { width: number; height: number; data: Uint8Array };
  cells: SliceGrid['cells'];
  names: string[];
  cols: number;
  rows: number;
}): void {
  const background = mostFrequentBorderColor(args.image);
  if (background === null) return;

  const offenders: { index: number; counts: EdgeCounts }[] = [];
  let activeCells = 0;
  for (const cell of args.cells) {
    if ((args.names[cell.index] ?? '').length === 0) continue;
    activeCells += 1;
    const counts = countCellEdgeForeground(args.image, cell, background);
    if (
      counts.top > MAX_EDGE_CONTENT_PIXELS_PER_EDGE ||
      counts.bottom > MAX_EDGE_CONTENT_PIXELS_PER_EDGE ||
      counts.left > MAX_EDGE_CONTENT_PIXELS_PER_EDGE ||
      counts.right > MAX_EDGE_CONTENT_PIXELS_PER_EDGE
    ) {
      offenders.push({ index: cell.index, counts });
    }
  }
  if (offenders.length === 0) return;

  const shown = offenders
    .slice(0, MAX_REPORTED_EDGE_CELLS)
    .map(
      ({ index, counts }) =>
        `${index + 1} (top ${counts.top}px, bottom ${counts.bottom}px, left ${counts.left}px, right ${counts.right}px)`
    );
  const remaining = offenders.length - shown.length;
  const cellList = remaining > 0 ? `${shown.join(', ')}, and ${remaining} more` : shown.join(', ');
  throw new SliceImageError(
    `Artwork crosses cell borders in ${offenders.length} of ${activeCells} cells (cells: ${cellList}). The sheet probably does not match a ${args.cols}x${args.rows} grid of equal cells. Regenerate the sheet with one separate item per cell and no drawn grid lines, or pass --allow-edge-content to slice anyway.`
  );
}

// The pipeline is a linear sequence of validated stages; splitting it would
// spread the "nothing is written before every check passes" invariant.
// fallow-ignore-next-line complexity
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

  // 2. The source must be a regular file, checked by stat before we read it.
  const inputStat = await deps.statInput(inPath);
  if (inputStat.kind === 'missing') {
    throw new SliceImageError(`--in not found: ${inPath}`);
  }
  if (inputStat.kind === 'directory') {
    throw new SliceImageError(`--in is a directory: ${inPath}. Pass a PNG file path.`);
  }
  if (inputStat.kind === 'other') {
    throw new SliceImageError(`--in is not a regular file: ${inPath}. Pass a PNG file path.`);
  }
  if (inputStat.size > MAX_SOURCE_BYTES) {
    throw new SliceImageError(
      `--in is ${inputStat.size} bytes; the maximum is ${MAX_SOURCE_BYTES} bytes (64 MiB).`
    );
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
      "--in is not a PNG. slice-image only reads PNG sheets; regenerate with 'chatroom generate-image --model <id> --output-format png'."
    );
  }

  // 4. Refuse an oversized sheet from its IHDR before pngjs allocates pixels.
  const dimensions = readPngDimensions(bytes);
  if (dimensions === null) {
    throw new SliceImageError('Could not decode --in as PNG: missing or invalid IHDR header.');
  }
  if (dimensions.width === 0 || dimensions.height === 0) {
    throw new SliceImageError(
      `--in has invalid dimensions ${dimensions.width}x${dimensions.height}.`
    );
  }
  if (dimensions.width * dimensions.height > MAX_SOURCE_PIXELS) {
    throw new SliceImageError(
      `--in is ${dimensions.width}x${dimensions.height} (${dimensions.width * dimensions.height} pixels); the maximum is ${MAX_SOURCE_PIXELS} pixels.`
    );
  }

  // 5. Decode in memory. A malformed PNG is a clear input error.
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
  if (image.data.length !== image.width * image.height * 4) {
    throw new SliceImageError(
      `Could not decode --in as PNG: expected ${image.width * image.height * 4} RGBA bytes, got ${image.data.length}.`
    );
  }
  const sheetSha = sha256(bytes);

  // 6. Geometry, names, and every output path.
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

  // 6b. Refuse artwork that crosses an internal cell border before any preflight
  // or encode work, and before a dry run reports success. Skipped cells do not
  // count, so a caller can deliberately omit an unusable cell.
  if (opts.allowEdgeContent !== true) {
    requireNoEdgeContent({
      image,
      cells: grid.cells,
      names,
      cols,
      rows,
    });
  }

  // 7. Read the optional generate-image sidecar. It never blocks a slice.
  const warnings: string[] = [];
  if (grid.droppedRight > 0 || grid.droppedBottom > 0) {
    warnings.push(
      `Dropped ${grid.droppedRight}px on the right and ${grid.droppedBottom}px at the bottom to fit the ${cols}x${rows} grid.`
    );
  }

  let sourceManifest: SliceSourceManifest | null = null;
  try {
    const manifestStat = await deps.statInput(sourceManifestPath);
    if (manifestStat.kind === 'missing') {
      warnings.push(
        `No generate-image manifest at ${sourceManifestPath}; tile manifests record the sheet hash only.`
      );
    } else if (manifestStat.kind !== 'file') {
      warnings.push(`Ignoring ${sourceManifestPath}: it is not a regular file.`);
    } else if (manifestStat.size > MAX_SIDECAR_BYTES) {
      warnings.push(
        `Ignoring ${sourceManifestPath}: ${manifestStat.size} bytes is larger than the ${MAX_SIDECAR_BYTES}-byte sidecar limit.`
      );
    } else {
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

  // 8. Refuse every unwritable output before a single byte is written.
  const allOutputPaths = [
    ...outputs.flatMap((output) => [output.path, output.manifestPath]),
    indexPath,
  ];
  const sourceIdentities = [
    await deps.fileIdentity(inPath),
    await deps.fileIdentity(sourceManifestPath),
  ];
  await preflightOutputs(
    deps,
    allOutputPaths,
    new Set([inPath, sourceManifestPath]),
    sourceIdentities,
    force
  );

  // 9. Crop and encode everything in memory. Any failure leaves the disk alone.
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

  // 10. A dry run reports exactly what would happen, but creates nothing.
  if (dryRun) return result;

  // 11. Write tiles in index order, then the sheet index last.
  await deps.ensureDir(outDir);
  const slicedAt = deps.now().toISOString();
  const decoder = `pngjs@${deps.decoderVersion}`;
  const written: string[] = [];
  const writeOptions = { exclusive: !force };

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
    await write(tile.path, () => deps.writeFile(tile.path, tile.encodedBytes, writeOptions));
    await write(tile.manifestPath, () => deps.writeJson(tile.manifestPath, manifest, writeOptions));
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
  await write(indexPath, () => deps.writeJson(indexPath, index, writeOptions));

  return result;
}
