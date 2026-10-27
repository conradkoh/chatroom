/**
 * `chatroom remove-image-background` orchestration.
 *
 * Runs after `slice-image`: each input tile is keyed in memory, encoded, and
 * written with a manifest. Nothing is written until every input has been read,
 * decoded, keyed, and encoded, and every output has passed preflight.
 */

import { basename, dirname, extname, join, resolve } from 'node:path';

import {
  keyBackground,
  DEFAULT_MIN_AREA_PERCENT,
  DEFAULT_TOLERANCE,
  type KeyResult,
} from './background-key.js';
import type { RemoveImageBackgroundDeps } from './remove-image-background-deps.js';
import { MAX_TRIM_PADDING, cropRgba, trimRect, type TrimRect } from './trim-crop.js';
import {
  MAX_SIDECAR_BYTES,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_PIXELS,
  SAFE_NAME,
  errorMessage,
  findOutputConflicts,
  formatConflicts,
  hasPngMagic,
  isRecord,
  readPngDimensions,
  sha256,
} from '../image-shared/image-preflight.js';

// fallow-ignore-next-line unused-export
export class RemoveBackgroundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemoveBackgroundError';
  }
}

const TOOL = 'chatroom remove-image-background' as const;
const MAX_BATCH_FILES = 64;

export interface RemoveBackgroundOptions {
  in?: string | undefined;
  out?: string | undefined;
  inDir?: string | undefined;
  outDir?: string | undefined;
  /** tileStem -> assetName; directory mode only. */
  map?: Record<string, string> | undefined;
  /** Integer 1..128; default 24. */
  tolerance?: number | undefined;
  /** Percent 0..50; default 0.5. */
  minArea?: number | undefined;
  allowEdgeContent?: boolean | undefined;
  /** Crop each asset to its keyed content box. */
  trim?: boolean | undefined;
  /** Pixels kept around the trimmed content; integer 0..64. */
  trimPadding?: number | undefined;
  force?: boolean | undefined;
  dryRun?: boolean | undefined;
}

export interface IsolatedAsset {
  sourceStem: string;
  assignedName: string;
  sourcePath: string;
  path: string;
  manifestPath: string;
  sha256: string;
  width: number;
  height: number;
  components: number;
  contentBox: { x: number; y: number; width: number; height: number };
  centerOffset: { x: number; y: number };
  background: [number, number, number];
  trimmed: boolean;
  warnings: string[];
}

export interface RemoveBackgroundResult {
  dryRun: boolean;
  assets: IsolatedAsset[];
  ignoredNonPng: number;
  warnings: string[];
}

interface DecodedTile {
  width: number;
  height: number;
  data: Uint8Array;
}

interface InputTile {
  path: string;
  stem: string;
  bytes: Uint8Array;
  image: DecodedTile;
  sha256: string;
}

interface TileManifest {
  tool: unknown;
  gridIndex: unknown;
  row: unknown;
  col: unknown;
  crop: unknown;
  outputSha256: string | null;
  sha256Matches: boolean | null;
  sheet: unknown;
}

interface ParsedSidecar {
  manifestPath: string | null;
  manifest: TileManifest | null;
  warnings: string[];
}

interface NamedTile extends InputTile {
  assignedName: string;
  assignedBy: 'map' | 'out' | 'source-stem';
  sidecar: ParsedSidecar;
}

interface TrimInfo {
  padding: number;
  rect: TrimRect;
  sizeBefore: { width: number; height: number };
  sizeAfter: { width: number; height: number };
}

interface PreparedAsset {
  tile: NamedTile;
  keyed: Extract<KeyResult, { ok: true }>;
  encoded: Uint8Array;
  sha256: string;
  path: string;
  manifestPath: string;
  outputWidth: number;
  outputHeight: number;
  trim: TrimInfo | null;
  warnings: string[];
}

type Mode =
  | { kind: 'single'; inPath: string; outPath: string; outDir: string }
  | { kind: 'dir'; inDir: string; outDir: string };

// fallow-ignore-next-line complexity
function resolveMode(opts: RemoveBackgroundOptions): Mode {
  const hasSingle = opts.in !== undefined || opts.out !== undefined;
  const hasDir = opts.inDir !== undefined || opts.outDir !== undefined;
  if (hasSingle && hasDir) {
    throw new RemoveBackgroundError(
      'Pass either --in with --out, or --in-dir with --out-dir, not both.'
    );
  }
  if (!hasSingle && !hasDir) {
    throw new RemoveBackgroundError('Pass either --in with --out, or --in-dir with --out-dir.');
  }
  if (hasSingle) {
    if (opts.in === undefined || opts.out === undefined) {
      throw new RemoveBackgroundError('--in and --out must be used together.');
    }
    if (!opts.out.toLowerCase().endsWith('.png')) {
      throw new RemoveBackgroundError('--out must end in .png.');
    }
    const outPath = resolve(opts.out);
    return { kind: 'single', inPath: resolve(opts.in), outPath, outDir: dirname(outPath) };
  }
  if (opts.inDir === undefined || opts.outDir === undefined) {
    throw new RemoveBackgroundError('--in-dir and --out-dir must be used together.');
  }
  return { kind: 'dir', inDir: resolve(opts.inDir), outDir: resolve(opts.outDir) };
}

// fallow-ignore-next-line complexity
function requireRanges(opts: RemoveBackgroundOptions): {
  tolerance: number;
  minAreaPercent: number;
  trimPadding: number;
} {
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE;
  if (!Number.isInteger(tolerance) || tolerance < 1 || tolerance > 128) {
    throw new RemoveBackgroundError('--tolerance must be an integer between 1 and 128.');
  }
  const minAreaPercent = opts.minArea ?? DEFAULT_MIN_AREA_PERCENT;
  if (!Number.isFinite(minAreaPercent) || minAreaPercent < 0 || minAreaPercent > 50) {
    throw new RemoveBackgroundError('--min-area must be a number between 0 and 50.');
  }
  const trimPadding = opts.trimPadding ?? 0;
  if (opts.trimPadding !== undefined && opts.trim !== true) {
    throw new RemoveBackgroundError('--trim-padding is only valid with --trim.');
  }
  if (!Number.isInteger(trimPadding) || trimPadding < 0 || trimPadding > MAX_TRIM_PADDING) {
    throw new RemoveBackgroundError(
      `--trim-padding must be an integer between 0 and ${MAX_TRIM_PADDING}.`
    );
  }
  return { tolerance, minAreaPercent, trimPadding };
}

async function enumerateInputs(
  mode: Mode,
  deps: RemoveImageBackgroundDeps
): Promise<{ inputs: { path: string; stem: string }[]; ignoredNonPng: number }> {
  if (mode.kind === 'single') {
    return {
      inputs: [{ path: mode.inPath, stem: basename(mode.inPath, extname(mode.inPath)) }],
      ignoredNonPng: 0,
    };
  }
  const entries = await deps.listDir(mode.inDir);
  const pngs = entries.filter((entry) => entry.endsWith('.png')).sort();
  if (pngs.length === 0) {
    throw new RemoveBackgroundError(`No PNG files found in ${mode.inDir}.`);
  }
  if (pngs.length > MAX_BATCH_FILES) {
    throw new RemoveBackgroundError(
      `${mode.inDir} contains ${pngs.length} PNG files; the maximum is ${MAX_BATCH_FILES}.`
    );
  }
  return {
    inputs: pngs.map((name) => ({ path: join(mode.inDir, name), stem: basename(name, '.png') })),
    ignoredNonPng: entries.length - pngs.length,
  };
}

// fallow-ignore-next-line complexity
interface InspectedTile {
  path: string;
  stem: string;
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** Read and validate PNG headers without decoding any pixels. */
// fallow-ignore-next-line complexity
async function inspectInput(
  input: { path: string; stem: string },
  deps: RemoveImageBackgroundDeps
): Promise<InspectedTile> {
  const stats = await deps.statInput(input.path);
  if (stats.kind === 'missing') throw new RemoveBackgroundError(`Input not found: ${input.path}`);
  if (stats.kind !== 'file') {
    throw new RemoveBackgroundError(`Input is not a regular file: ${input.path}`);
  }
  if (stats.size > MAX_SOURCE_BYTES) {
    throw new RemoveBackgroundError(
      `${input.path} is ${stats.size} bytes; the maximum is ${MAX_SOURCE_BYTES} bytes (64 MiB).`
    );
  }
  const bytes = await deps.readFile(input.path);
  if (bytes.byteLength > MAX_SOURCE_BYTES) {
    throw new RemoveBackgroundError(
      `${input.path} is ${bytes.byteLength} bytes; the maximum is ${MAX_SOURCE_BYTES} bytes (64 MiB).`
    );
  }
  if (!hasPngMagic(bytes)) throw new RemoveBackgroundError(`${input.path} is not a PNG.`);
  const dimensions = readPngDimensions(bytes);
  if (dimensions === null || dimensions.width === 0 || dimensions.height === 0) {
    throw new RemoveBackgroundError(`Could not decode ${input.path}: missing or invalid IHDR.`);
  }
  if (dimensions.width * dimensions.height > MAX_SOURCE_PIXELS) {
    throw new RemoveBackgroundError(
      `${input.path} is ${dimensions.width}x${dimensions.height}; the maximum is ${MAX_SOURCE_PIXELS} pixels.`
    );
  }
  return { ...input, bytes, width: dimensions.width, height: dimensions.height };
}

function decodeInput(inspected: InspectedTile, deps: RemoveImageBackgroundDeps): InputTile {
  let image: DecodedTile;
  try {
    image = deps.decodePng(inspected.bytes);
  } catch (err) {
    throw new RemoveBackgroundError(`Could not decode ${inspected.path}: ${errorMessage(err)}`);
  }
  if (image.data.length !== image.width * image.height * 4) {
    throw new RemoveBackgroundError(`Could not decode ${inspected.path}: expected RGBA data.`);
  }
  return {
    path: inspected.path,
    stem: inspected.stem,
    bytes: inspected.bytes,
    image,
    sha256: sha256(inspected.bytes),
  };
}

function requireSafeName(name: string, context: string): string {
  if (!SAFE_NAME.test(name)) {
    throw new RemoveBackgroundError(
      `${context} "${name}" is not a safe file name. Use letters, digits, "_" or "-" (max 64 characters, starting with a letter, digit, or "_").`
    );
  }
  return name;
}

/** Assign one output stem per tile and reject unknown keys and duplicates. */
// fallow-ignore-next-line complexity
function assignNames(
  mode: Mode,
  opts: RemoveBackgroundOptions,
  tiles: InputTile[]
): { tile: InputTile; assignedName: string; assignedBy: 'map' | 'out' | 'source-stem' }[] {
  if (mode.kind === 'single') {
    const name = requireSafeName(basename(mode.outPath, '.png'), '--out');
    return [{ tile: tiles[0] as InputTile, assignedName: name, assignedBy: 'out' }];
  }
  const stems = new Set(tiles.map((tile) => tile.stem));
  for (const key of Object.keys(opts.map ?? {})) {
    if (!stems.has(key)) {
      throw new RemoveBackgroundError(
        `--map entry "${key}" does not match a tile stem. Valid stems: ${[...stems].sort().join(', ')}.`
      );
    }
  }
  const seen = new Map<string, string>();
  // fallow-ignore-next-line complexity
  return tiles.map((tile) => {
    const mapped =
      opts.map !== undefined && Object.hasOwn(opts.map, tile.stem)
        ? opts.map[tile.stem]
        : undefined;
    const assignedBy = mapped === undefined ? 'source-stem' : 'map';
    const assignedName = requireSafeName(
      mapped ?? tile.stem,
      mapped === undefined ? `Tile stem "${tile.stem}"` : `--map value for "${tile.stem}"`
    );
    const key = assignedName.toLowerCase();
    const previous = seen.get(key);
    if (previous !== undefined) {
      throw new RemoveBackgroundError(
        `Duplicate output name "${key}" for tiles "${previous}" and "${tile.stem}" (names are compared case-insensitively).`
      );
    }
    seen.set(key, tile.stem);
    return { tile, assignedName, assignedBy };
  });
}

// fallow-ignore-next-line complexity
async function readSidecar(
  tile: InputTile,
  deps: RemoveImageBackgroundDeps
): Promise<ParsedSidecar> {
  const path = `${tile.path}.json`;
  const stats = await deps.statInput(path);
  if (stats.kind === 'missing') {
    return {
      manifestPath: null,
      manifest: null,
      warnings: [`No tile manifest at ${path}; source provenance is missing.`],
    };
  }
  if (stats.kind !== 'file') {
    return {
      manifestPath: null,
      manifest: null,
      warnings: [`Ignoring ${path}: it is not a regular file.`],
    };
  }
  if (stats.size > MAX_SIDECAR_BYTES) {
    return {
      manifestPath: null,
      manifest: null,
      warnings: [
        `Ignoring ${path}: ${stats.size} bytes is larger than the ${MAX_SIDECAR_BYTES}-byte sidecar limit.`,
      ],
    };
  }
  let raw: unknown;
  try {
    raw = await deps.readJsonIfExists(path);
  } catch (err) {
    return {
      manifestPath: null,
      manifest: null,
      warnings: [`Ignoring ${path}: ${errorMessage(err)}`],
    };
  }
  if (raw === undefined) {
    return {
      manifestPath: null,
      manifest: null,
      warnings: [`No tile manifest at ${path}; source provenance is missing.`],
    };
  }
  if (!isRecord(raw)) {
    return {
      manifestPath: null,
      manifest: null,
      warnings: [`Ignoring ${path}: it is not a JSON object.`],
    };
  }
  return parseSidecar(path, raw, tile.sha256);
}

// fallow-ignore-next-line complexity
function parseSidecar(path: string, raw: Record<string, unknown>, tileSha: string): ParsedSidecar {
  const output = isRecord(raw.output) ? raw.output : undefined;
  const grid = isRecord(raw.grid) ? raw.grid : undefined;
  const outputSha256 = typeof output?.sha256 === 'string' ? output.sha256 : null;
  const sha256Matches = outputSha256 === null ? null : outputSha256 === tileSha;
  const warnings: string[] = [];
  if (sha256Matches === false) {
    warnings.push(
      `Tile manifest records output.sha256 ${outputSha256}, which does not match the tile (${tileSha}); the tile may have been edited.`
    );
  }
  return {
    manifestPath: path,
    manifest: {
      tool: raw.tool,
      gridIndex: grid?.index,
      row: grid?.row,
      col: grid?.col,
      crop: raw.crop,
      outputSha256,
      sha256Matches,
      sheet: isRecord(raw.source) ? raw.source : null,
    },
    warnings,
  };
}

// fallow-ignore-next-line complexity
function assetWarnings(
  tile: InputTile,
  keyed: Extract<KeyResult, { ok: true }>,
  sidecarWarnings: string[]
): string[] {
  const warnings = [...sidecarWarnings];
  if (keyed.components > 1) {
    warnings.push(
      `${keyed.components} separate regions kept in ${tile.path}; if the tile holds more than one item, regenerate or re-slice`
    );
  }
  if (keyed.foregroundRatio > 0.8) {
    warnings.push(
      `Foreground covers ${(keyed.foregroundRatio * 100).toFixed(1)}% of ${tile.path}; check that the background is uniform.`
    );
  }
  if (keyed.enclosedBackgroundLike > 0.005 * tile.image.width * tile.image.height) {
    warnings.push(`Background-coloured holes remain opaque in ${tile.path}.`);
  }
  if (keyed.touchesTileEdge) {
    warnings.push(`Artwork touches the edge of ${tile.path}; the cut may be clipped.`);
  }
  if (keyed.droppedSpecks.count > 0) {
    warnings.push(
      `Dropped ${keyed.droppedSpecks.count} speck(s) (${keyed.droppedSpecks.pixels} px) in ${tile.path}.`
    );
  }
  return warnings;
}

function buildManifest(
  asset: PreparedAsset,
  deps: RemoveImageBackgroundDeps,
  tolerance: number,
  minAreaPercent: number,
  isolatedAt: string
) {
  const { tile, keyed, encoded } = asset;
  return {
    tool: TOOL,
    decoder: `pngjs@${deps.decoderVersion}`,
    source: {
      path: tile.path,
      sha256: tile.sha256,
      bytes: tile.bytes.byteLength,
      width: tile.image.width,
      height: tile.image.height,
      manifestPath: tile.sidecar.manifestPath,
      manifest: tile.sidecar.manifest,
    },
    naming: {
      sourceStem: tile.stem,
      assignedName: tile.assignedName,
      assignedBy: tile.assignedBy,
    },
    keying: {
      method: 'border-flood-fill' as const,
      background: keyed.background,
      tolerance,
      minAreaPercent,
      feather: 'linear-T-to-2T' as const,
      floodConnectivity: 4 as const,
      componentConnectivity: 8 as const,
    },
    result: {
      components: keyed.components,
      foregroundPixels: keyed.foregroundPixels,
      foregroundRatio: keyed.foregroundRatio,
      droppedSpecks: keyed.droppedSpecks,
      enclosedBackgroundLike: keyed.enclosedBackgroundLike,
      contentBox: keyed.contentBox,
      centerOffset: keyed.centerOffset,
      touchesTileEdge: keyed.touchesTileEdge,
    },
    output: {
      path: asset.path,
      sha256: asset.sha256,
      contentType: 'image/png' as const,
      bytes: encoded.byteLength,
      width: asset.outputWidth,
      height: asset.outputHeight,
      hasAlpha: true as const,
    },
    trim: asset.trim,
    isolatedAt,
    licensing: 'unverified' as const,
  };
}

async function preflight(
  outputs: string[],
  tiles: InputTile[],
  force: boolean,
  deps: RemoveImageBackgroundDeps
): Promise<void> {
  const sourcePaths = new Set<string>();
  const sourceIdentities = [];
  for (const tile of tiles) {
    sourcePaths.add(tile.path);
    sourcePaths.add(`${tile.path}.json`);
    sourceIdentities.push(await deps.fileIdentity(tile.path));
    sourceIdentities.push(await deps.fileIdentity(`${tile.path}.json`));
  }
  const conflicts = await findOutputConflicts(deps, outputs, sourcePaths, sourceIdentities, force);
  if (conflicts.length > 0) throw new RemoveBackgroundError(formatConflicts(conflicts));
}

function encodeAsset(
  image: DecodedTile,
  keyed: Extract<KeyResult, { ok: true }>,
  options: { trim: boolean; trimPadding: number },
  deps: RemoveImageBackgroundDeps
): {
  encoded: Uint8Array;
  outputWidth: number;
  outputHeight: number;
  trim: TrimInfo | null;
} {
  if (!options.trim) {
    return {
      encoded: deps.encodePng({ width: image.width, height: image.height, data: keyed.data }),
      outputWidth: image.width,
      outputHeight: image.height,
      trim: null,
    };
  }
  const rect = trimRect(keyed.contentBox, image.width, image.height, options.trimPadding);
  const encoded = deps.encodePng({
    width: rect.width,
    height: rect.height,
    data: cropRgba(keyed.data, image.width, rect),
  });
  return {
    encoded,
    outputWidth: rect.width,
    outputHeight: rect.height,
    trim: {
      padding: options.trimPadding,
      rect,
      sizeBefore: { width: image.width, height: image.height },
      sizeAfter: { width: rect.width, height: rect.height },
    },
  };
}

async function prepareAssets(
  named: ReturnType<typeof assignNames>,
  mode: Mode,
  options: {
    tolerance: number;
    minAreaPercent: number;
    allowEdgeContent: boolean;
    trim: boolean;
    trimPadding: number;
  },
  deps: RemoveImageBackgroundDeps
): Promise<PreparedAsset[]> {
  const prepared: PreparedAsset[] = [];
  for (const entry of named) {
    const sidecar = await readSidecar(entry.tile, deps);
    const namedTile: NamedTile = {
      ...entry.tile,
      assignedName: entry.assignedName,
      assignedBy: entry.assignedBy,
      sidecar,
    };
    const keyed = keyBackground(entry.tile.image, options);
    if (!keyed.ok) {
      throw new RemoveBackgroundError(
        `Cannot remove the background from ${entry.tile.path}: ${keyed.message}`
      );
    }
    const { encoded, outputWidth, outputHeight, trim } = encodeAsset(
      entry.tile.image,
      keyed,
      options,
      deps
    );
    const path =
      mode.kind === 'single' ? mode.outPath : join(mode.outDir, `${entry.assignedName}.png`);
    prepared.push({
      tile: namedTile,
      keyed,
      encoded,
      sha256: sha256(encoded),
      path,
      manifestPath: `${path}.json`,
      outputWidth,
      outputHeight,
      trim,
      warnings: assetWarnings(entry.tile, keyed, sidecar.warnings),
    });
  }
  return prepared;
}

function toAssets(prepared: PreparedAsset[]): IsolatedAsset[] {
  return prepared.map((asset) => ({
    sourceStem: asset.tile.stem,
    assignedName: asset.tile.assignedName,
    sourcePath: asset.tile.path,
    path: asset.path,
    manifestPath: asset.manifestPath,
    sha256: asset.sha256,
    width: asset.outputWidth,
    height: asset.outputHeight,
    components: asset.keyed.components,
    contentBox: asset.keyed.contentBox,
    centerOffset: asset.keyed.centerOffset,
    background: asset.keyed.background,
    trimmed: asset.trim !== null,
    warnings: asset.warnings,
  }));
}

async function writePrepared(
  prepared: PreparedAsset[],
  outDir: string,
  options: { force: boolean; tolerance: number; minAreaPercent: number },
  deps: RemoveImageBackgroundDeps
): Promise<void> {
  await deps.ensureDir(outDir);
  const isolatedAt = deps.now().toISOString();
  const written: string[] = [];
  const write = async (path: string, action: () => Promise<void>): Promise<void> => {
    try {
      await action();
      written.push(path);
    } catch (err) {
      throw new RemoveBackgroundError(
        `Failed to write ${path}: ${errorMessage(err)}. Already written: ${written.length > 0 ? written.join(', ') : 'none'}. Re-run with --force after fixing the cause.`
      );
    }
  };
  for (const asset of prepared) {
    const manifest = buildManifest(
      asset,
      deps,
      options.tolerance,
      options.minAreaPercent,
      isolatedAt
    );
    await write(asset.path, () =>
      deps.writeFile(asset.path, asset.encoded, { exclusive: !options.force })
    );
    await write(asset.manifestPath, () =>
      deps.writeJson(asset.manifestPath, manifest, { exclusive: !options.force })
    );
  }
}

/**
 * Key every input tile and write the isolated assets plus manifests.
 *
 * Stage order is the safety contract: no filesystem write happens until every
 * input is loaded, keyed, encoded, and preflighted, and until the caller is not
 * in dry-run mode.
 */
// fallow-ignore-next-line complexity
export async function removeImageBackground(
  opts: RemoveBackgroundOptions,
  deps: RemoveImageBackgroundDeps
): Promise<RemoveBackgroundResult> {
  const mode = resolveMode(opts);
  if (mode.kind === 'single' && opts.map !== undefined) {
    throw new RemoveBackgroundError('--map is only valid with --in-dir and --out-dir.');
  }
  const { tolerance, minAreaPercent, trimPadding } = requireRanges(opts);
  const options = {
    tolerance,
    minAreaPercent,
    allowEdgeContent: opts.allowEdgeContent === true,
    trim: opts.trim === true,
    trimPadding,
  };

  const { inputs, ignoredNonPng } = await enumerateInputs(mode, deps);
  const inspected: InspectedTile[] = [];
  let totalPixels = 0;
  for (const input of inputs) {
    const tile = await inspectInput(input, deps);
    totalPixels += tile.width * tile.height;
    inspected.push(tile);
  }
  if (totalPixels > MAX_SOURCE_PIXELS) {
    throw new RemoveBackgroundError(
      `Inputs total ${totalPixels} pixels; the maximum is ${MAX_SOURCE_PIXELS} pixels.`
    );
  }
  const tiles = inspected.map((tile) => decodeInput(tile, deps));

  const prepared = await prepareAssets(assignNames(mode, opts, tiles), mode, options, deps);
  await preflight(
    prepared.flatMap((asset) => [asset.path, asset.manifestPath]),
    tiles,
    opts.force === true,
    deps
  );

  const result: RemoveBackgroundResult = {
    dryRun: opts.dryRun === true,
    assets: toAssets(prepared),
    ignoredNonPng,
    warnings: [],
  };
  if (result.dryRun) return result;

  await writePrepared(
    prepared,
    mode.outDir,
    { force: opts.force === true, tolerance, minAreaPercent },
    deps
  );
  return result;
}
