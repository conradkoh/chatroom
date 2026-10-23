/**
 * `chatroom remove-image-background` — local transparent-background pass.
 *
 * Runs after `slice-image`. One tile becomes one asset; nothing is split. The
 * command is fully local and loads pngjs only inside the action.
 */

import { InvalidArgumentError, type Command } from 'commander';

import { removeImageBackground, type RemoveBackgroundOptions } from './remove-background.js';
import { MAX_TRIM_PADDING } from './trim-crop.js';

const DECIMAL_INTEGER = /^\d+$/;
const DECIMAL_PERCENT = /^\d+(?:\.\d+)?$/;

// fallow-ignore-next-line complexity
function parseTolerance(value: string): number {
  const parsed = Number(value);
  if (!DECIMAL_INTEGER.test(value) || !Number.isInteger(parsed) || parsed < 1 || parsed > 128) {
    throw new InvalidArgumentError('must be an integer between 1 and 128');
  }
  return parsed;
}

// fallow-ignore-next-line complexity
function parseMinArea(value: string): number {
  const parsed = Number(value);
  if (!DECIMAL_PERCENT.test(value) || !Number.isFinite(parsed) || parsed < 0 || parsed > 50) {
    throw new InvalidArgumentError('must be a number between 0 and 50');
  }
  return parsed;
}

// fallow-ignore-next-line complexity
function parseTrimPadding(value: string): number {
  const parsed = Number(value);
  if (
    !DECIMAL_INTEGER.test(value) ||
    !Number.isInteger(parsed) ||
    parsed < 0 ||
    parsed > MAX_TRIM_PADDING
  ) {
    throw new InvalidArgumentError(`must be an integer between 0 and ${MAX_TRIM_PADDING}`);
  }
  return parsed;
}

// fallow-ignore-next-line complexity
function parseMap(value: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of value.split(',')) {
    const separator = entry.indexOf('=');
    if (separator < 0) {
      throw new InvalidArgumentError(`entry "${entry}" must be <tile>=<name>`);
    }
    const key = entry.slice(0, separator).trim();
    const name = entry.slice(separator + 1).trim();
    if (key.length === 0 || name.length === 0) {
      throw new InvalidArgumentError(`entry "${entry}" must have a non-empty tile and name`);
    }
    if (map[key] !== undefined) {
      throw new InvalidArgumentError(`duplicate tile "${key}"`);
    }
    map[key] = name;
  }
  return map;
}

interface RemoveBackgroundCliOptions {
  in?: string | undefined;
  out?: string | undefined;
  inDir?: string | undefined;
  outDir?: string | undefined;
  map?: Record<string, string> | undefined;
  tolerance: number;
  minArea: number;
  allowEdgeContent?: boolean | undefined;
  trim?: boolean | undefined;
  trimPadding?: number | undefined;
  force?: boolean | undefined;
  dryRun?: boolean | undefined;
}

/**
 * Help text after the option list. This is the reference users and agents read;
 * it states the purpose, algorithm, naming, refusals, limits, and examples.
 */
const HELP_AFTER = `
Usage:
  chatroom remove-image-background (--in <png> --out <png> | --in-dir <dir> --out-dir <dir>)
    [--map <tile=name,...>] [--tolerance <1-128>] [--min-area <percent>]
    [--allow-edge-content] [--trim] [--trim-padding <px>] [--force] [--dry-run]

Purpose:
  Run after chatroom slice-image. One input tile becomes one asset; the canvas
  size is kept and disconnected regions are never split.

Algorithm:
  - Background: the per-channel median of the tile's outer 1-px border.
  - Tolerance: a pixel within the Chebyshev distance is background material.
  - Flood fill: 4-connected from the border, so enclosed holes stay opaque.
  - Speck filter: 8-connected regions under --min-area percent are removed.
  - Edge ramp: kept pixels next to keyed background fade linearly from T to 2T.

Trim:
  --trim crops each asset to its opaque content. Use --trim-padding to keep a
  border. The centre offset in the manifest is measured before the crop.
  Trimmed assets differ in size, so use per-sprite pivots or bounds-based
  placement.

Naming:
  In single mode the output name is the stem of --out. In directory mode each
  tile uses its --map value when present, otherwise its own stem. Names must be
  safe (letters, digits, "_" or "-") and unique case-insensitively.

Refusals:
  A non-uniform border, no foreground, outputs equal to an input tile or its
  manifest, a symlink or directory in the way, existing outputs without --force,
  bad names, unknown --map keys, and mode combinations other than one
  --in/--out pair or one --in-dir/--out-dir pair. Every conflict is listed.

Limits:
  Background-coloured holes stay opaque; there is no colour decontamination and
  no component splitting. PNG only. The command is local: no network call and no
  FAL_API_KEY are needed.

Examples:
  chatroom remove-image-background --in tiles/potion.png --out assets/potion.png
  chatroom remove-image-background --in-dir tiles --out-dir assets \\
    --map potion=potion_hd,sword=sword_hd --tolerance 20
  chatroom remove-image-background --in-dir tiles --out-dir assets \\
    --map items-01=potion --trim --trim-padding 2
`;

// fallow-ignore-next-line complexity
function printResult(result: Awaited<ReturnType<typeof removeImageBackground>>): void {
  for (const asset of result.assets) {
    const verb = result.dryRun ? 'Would isolate' : 'Isolated';
    console.log(
      `${verb} ${asset.path} (${asset.components} region(s), content ${asset.contentBox.width}x${asset.contentBox.height} at ${asset.contentBox.x},${asset.contentBox.y}, offset ${asset.centerOffset.x},${asset.centerOffset.y}, bg ${asset.background.join(',')}${asset.trimmed ? `, trimmed to ${asset.width}x${asset.height}` : ''})`
    );
    for (const warning of asset.warnings) console.error(`⚠️ ${warning}`);
  }
  for (const warning of result.warnings) console.error(`⚠️ ${warning}`);
}

export function registerRemoveImageBackgroundCommand(program: Command): void {
  program
    .command('remove-image-background')
    .description('Key a tile background to transparency and write an isolated PNG asset')
    .option('--in <png>', 'Single input tile PNG')
    .option('--out <png>', 'Single output PNG path (must end in .png)')
    .option('--in-dir <dir>', 'Directory of input tile PNGs')
    .option('--out-dir <dir>', 'Directory for output PNGs and manifests')
    .option('--map <tile=name,...>', 'Directory-mode tile stem to output name mapping', parseMap)
    .option('--tolerance <1-128>', 'Background colour tolerance', parseTolerance, 24)
    .option(
      '--min-area <percent>',
      'Smallest kept region as a percent of the tile',
      parseMinArea,
      0.5
    )
    .option('--allow-edge-content', 'Keep artwork that touches the tile border')
    .option('--trim', 'Crop each asset to its opaque content')
    .option(
      '--trim-padding <px>',
      'Pixels kept around trimmed content (0-64, requires --trim)',
      parseTrimPadding
    )
    .option('--force', 'Overwrite existing outputs')
    .option('--dry-run', 'Report the assets without writing anything')
    .addHelpText('after', HELP_AFTER)
    .action(async (options: RemoveBackgroundCliOptions) => {
      try {
        const { createDefaultRemoveImageBackgroundDeps } =
          await import('./remove-background-deps.js');
        const removeOptions: RemoveBackgroundOptions = {
          in: options.in,
          out: options.out,
          inDir: options.inDir,
          outDir: options.outDir,
          map: options.map,
          tolerance: options.tolerance,
          minArea: options.minArea,
          allowEdgeContent: options.allowEdgeContent,
          trim: options.trim,
          trimPadding: options.trimPadding,
          force: options.force,
          dryRun: options.dryRun,
        };
        const result = await removeImageBackground(
          removeOptions,
          createDefaultRemoveImageBackgroundDeps()
        );
        printResult(result);
      } catch (err) {
        console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    });
}
