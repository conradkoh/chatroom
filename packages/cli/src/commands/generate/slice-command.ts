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
    .option('--force', 'Overwrite existing tile images and manifests')
    .option('--dry-run', 'Report the tiles without writing anything')
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
