/**
 * `chatroom slice-image` — local sprite-sheet slicing command.
 *
 * Slicing is fully local: it never calls the chatroom backend and never loads
 * the fal SDK, so it lives in the no-auth section of the CLI. The heavy pngjs
 * import is loaded inside the action to keep CLI startup fast.
 */

// printResult is a flat sequence of console lines; splitting it further would
// obscure the output contract.
// fallow-ignore-file complexity

import { InvalidArgumentError, type Command } from 'commander';

import { MAX_GRID_DIMENSION, sliceImage } from './slice.js';
import type { SliceImageOptions } from './slice.js';

const DECIMAL_INTEGER = /^\d+$/;

/**
 * Help text after the option list. This is the reference users and agents read,
 * so it states the full grammar, naming, output, and refusal rules without
 * pointing at repo docs.
 */
const HELP_AFTER = `
Usage:
  chatroom slice-image --in <path> --out-dir <dir> --cols <n> --rows <n> [--margin <px>] [--gutter <px>] [--names <a,b,,c,...> | --prefix <text>] [--allow-remainder] [--allow-edge-content] [--force] [--dry-run]

Grid:
  The sheet width must divide evenly by --cols and its height by --rows, or
  pass --allow-remainder to drop the leftover pixels on the right and bottom.
  --margin skips pixels on all four sides and --gutter sits between adjacent
  cells; both shrink the usable area, and every tile keeps the same size.
  The sheet must hold one item per cell, with no artwork touching the cell
  borders. The command refuses a sheet whose artwork crosses a border unless
  --allow-edge-content is given. Item names are not checked against the picture;
  inspect the tiles.

Naming:
  --names is row-major with one entry per cell. An empty entry skips that cell.
  Names must match ^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$ and be unique
  case-insensitively. --names and --prefix are mutually exclusive. Without
  either flag, names default to <stem>-01, <stem>-02, and so on.

Outputs:
  <name>.png per tile, <name>.png.json for its manifest, and <stem>.slices.json
  for the index, which is written last. Nothing is written when the command
  refuses an input or an output.

Refusals:
  Existing outputs without --force are refused, and every conflict is listed.
  An output that is the source sheet or its .json sidecar is refused even with
  --force, as is any output path that is a symbolic link. Non-PNG input is
  refused. Slicing is local: no network call and no FAL_API_KEY are needed.

Examples (default 1024x768 sheet, only if the sheet matches that grid):
  chatroom slice-image --in sheet.png --out-dir tiles --cols 4 --rows 3
    -> 12 tiles, each 256x256
  chatroom slice-image --in sheet.png --out-dir tiles --cols 2 --rows 2
    -> 4 tiles, each 512x384
  chatroom slice-image --in sheet.png --out-dir tiles --cols 3 --rows 2 --allow-remainder
    -> 6 tiles, each 341x384; 1 pixel is dropped on the right
`;

function parsePositiveInt(value: string): number {
  const parsed = Number(value);
  if (
    !DECIMAL_INTEGER.test(value) ||
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_GRID_DIMENSION
  ) {
    throw new InvalidArgumentError(`must be an integer between 1 and ${MAX_GRID_DIMENSION}`);
  }
  return parsed;
}

function parseNonNegativeInt(value: string): number {
  const parsed = Number(value);
  if (!DECIMAL_INTEGER.test(value) || !Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError('must be a non-negative integer');
  }
  return parsed;
}

/** Comma-separated names; empty entries stay in place so they skip their cell. */
function parseNames(value: string): string[] {
  return value.split(',').map((name) => name.trim());
}

interface SliceImageCliOptions {
  in: string;
  outDir: string;
  cols: number;
  rows: number;
  margin: number;
  gutter: number;
  names?: string[] | undefined;
  prefix?: string | undefined;
  allowRemainder?: boolean | undefined;
  allowEdgeContent?: boolean | undefined;
  force?: boolean | undefined;
  dryRun?: boolean | undefined;
}

function printResult(
  result: Awaited<ReturnType<typeof sliceImage>>,
  options: Pick<SliceImageCliOptions, 'cols' | 'rows'>
): void {
  const { sheet, tileSize } = result;
  console.log(
    `Sheet ${sheet.path} (${sheet.width}x${sheet.height}, sha256 ${sheet.sha256.slice(0, 12)}) -> ${options.cols}x${options.rows} grid, tile ${tileSize.width}x${tileSize.height}`
  );
  for (const tile of result.tiles) {
    const verb = result.dryRun ? 'Would slice' : 'Sliced';
    console.log(`${verb} ${tile.path} (${tile.x},${tile.y} ${tile.width}x${tile.height})`);
  }
  console.log(`Index ${result.indexPath}`);
  if (result.skipped.length > 0) {
    // Indexes are 0-based internally; report 1-based cells to match the grid.
    console.log(`Skipped cells: ${result.skipped.map((index) => index + 1).join(', ')}`);
  }
  for (const warning of result.warnings) {
    console.error(`⚠️ ${warning}`);
  }
}

export function registerSliceImageCommand(program: Command): void {
  program
    .command('slice-image')
    .description('Cut a PNG sprite sheet into a grid of named PNG tiles with manifests')
    .requiredOption('--in <path>', 'Source PNG sprite sheet')
    .requiredOption('--out-dir <dir>', 'Directory for tile images and manifests')
    .requiredOption('--cols <n>', 'Grid columns (1-64)', parsePositiveInt)
    .requiredOption('--rows <n>', 'Grid rows (1-64)', parsePositiveInt)
    .option('--margin <px>', 'Pixels skipped on all four sides', parseNonNegativeInt, 0)
    .option('--gutter <px>', 'Pixels between adjacent cells on both axes', parseNonNegativeInt, 0)
    .option(
      '--names <a,b,...>',
      'Comma-separated row-major tile names; an empty entry skips that cell',
      parseNames
    )
    .option('--prefix <text>', 'Prefix for default names (default: sheet file stem)')
    .option('--allow-remainder', 'Drop leftover pixels on the right/bottom instead of refusing')
    .option(
      '--allow-edge-content',
      'Skip the check that refuses sheets whose artwork crosses cell borders (for full-bleed or tileable art)'
    )
    .option('--force', 'Overwrite existing tile images and manifests')
    .option('--dry-run', 'Report the tiles without writing anything')
    .addHelpText('after', HELP_AFTER)
    .action(async (options: SliceImageCliOptions) => {
      try {
        // pngjs is only needed when the command actually runs.
        const { createDefaultSliceImageDeps } = await import('./slice-deps.js');
        const sliceOptions: SliceImageOptions = {
          in: options.in,
          outDir: options.outDir,
          cols: options.cols,
          rows: options.rows,
          margin: options.margin,
          gutter: options.gutter,
          names: options.names,
          prefix: options.prefix,
          allowRemainder: options.allowRemainder,
          allowEdgeContent: options.allowEdgeContent,
          force: options.force,
          dryRun: options.dryRun,
        };
        const result = await sliceImage(sliceOptions, createDefaultSliceImageDeps());
        printResult(result, options);
      } catch (err) {
        console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    });
}
