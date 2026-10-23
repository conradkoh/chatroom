/**
 * `chatroom remove-image-background-fal` — fal.ai background-removal command.
 *
 * Registration is fal-free: the SDK adapter is imported inside the action, so
 * `--help` and the rest of the CLI never load `@fal-ai/client` for this command.
 */

import { InvalidArgumentError, type Command } from 'commander';

import {
  DEFAULT_BACKGROUND_ENGINE,
  removeBackgroundFal,
  type BackgroundEngine,
} from './remove-background-fal.js';

const ENGINES: readonly BackgroundEngine[] = ['bria', 'birefnet'];

function parseEngine(value: string): BackgroundEngine {
  if (!ENGINES.includes(value as BackgroundEngine)) {
    throw new InvalidArgumentError(`must be one of ${ENGINES.join(', ')}`);
  }
  return value as BackgroundEngine;
}

interface RemoveBackgroundFalCliOptions {
  in: string;
  out: string;
  engine: BackgroundEngine;
  force?: boolean | undefined;
}

/**
 * Help text after the option list. This is the reference users and agents read;
 * it states the engines, refusals, limits, and billing expectations.
 */
const HELP_AFTER = `
Usage:
  chatroom remove-image-background-fal --in <png> --out <png>
    [--engine <bria|birefnet>] [--force]

Purpose:
  Cut the subject out of one PNG with fal.ai and write a PNG with alpha. For
  the offline colour-key pass, use chatroom remove-image-background.

Model:
  Background model: bria (default, fal-ai/bria/background/remove) or birefnet
  (previous BiRefNet Matting backend, fal-ai/birefnet/v2). The input is sent as
  a base64 data URI, so no separate upload step is needed. Both engines return
  a PNG with alpha.

Billing:
  bria is billed per call (about $0.018 at the time of writing). birefnet is
  billed per compute-second.

Refusals:
  A missing FAL_API_KEY, a missing or non-PNG input, an input over 8 MiB, an
  image over 100,000,000 pixels, and an existing output or manifest without
  --force are all refused before the paid fal call.

Limits:
  One image per invocation; there is no directory mode and no --model switch.
  The downloaded result must be a PNG no larger than 32 MiB.

Examples:
  chatroom remove-image-background-fal --in tiles/potion.png --out assets/potion.png
  chatroom remove-image-background-fal --in tiles/potion.png --out assets/potion.png --engine birefnet
`;

export function registerRemoveImageBackgroundFalCommand(program: Command): void {
  program
    .command('remove-image-background-fal')
    .description('Remove an image background with fal.ai and write a transparent PNG')
    .requiredOption('--in <png>', 'Input PNG to cut out')
    .requiredOption('--out <png>', 'Output PNG path for the image with alpha')
    .option(
      '--engine <engine>',
      'Background model: bria (default, fal-ai/bria/background/remove) or birefnet (previous BiRefNet Matting backend, fal-ai/birefnet/v2)',
      parseEngine,
      DEFAULT_BACKGROUND_ENGINE
    )
    .option('--force', 'Overwrite an existing output and manifest')
    .addHelpText('after', HELP_AFTER)
    .action(async (options: RemoveBackgroundFalCliOptions) => {
      try {
        const { createDefaultRemoveBackgroundFalDeps } =
          await import('./remove-background-fal-deps.js');
        const result = await removeBackgroundFal(
          { in: options.in, out: options.out, engine: options.engine, force: options.force },
          createDefaultRemoveBackgroundFalDeps()
        );
        console.log(`Removed background ${result.outPath} (${result.bytes} bytes)`);
        console.log(`Manifest ${result.manifestPath}`);
        console.log(`Request ${result.requestId}`);
      } catch (err) {
        console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    });
}
