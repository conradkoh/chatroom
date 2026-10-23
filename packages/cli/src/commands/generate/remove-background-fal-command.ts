/**
 * `chatroom remove-image-background-fal` — fal.ai BiRefNet cut-out command.
 *
 * Registration is fal-free: the SDK adapter is imported inside the action, so
 * `--help` and the rest of the CLI never load `@fal-ai/client` for this command.
 */

import type { Command } from 'commander';

import { removeBackgroundFal } from './remove-background-fal.js';

interface RemoveBackgroundFalCliOptions {
  in: string;
  out: string;
  force?: boolean | undefined;
}

/**
 * Help text after the option list. This is the reference users and agents read;
 * it states the model, refusals, limits, and billing expectations.
 */
const HELP_AFTER = `
Usage:
  chatroom remove-image-background-fal --in <png> --out <png> [--force]

Purpose:
  Cut the subject out of one PNG with fal.ai BiRefNet and write a PNG with
  alpha. For the offline colour-key pass, use chatroom remove-image-background.

Model:
  fal-ai/birefnet/v2 in Matting mode, with output_format png. The input is sent
  as a base64 data URI, so no separate upload step is needed.

Refusals:
  A missing FAL_API_KEY, a missing or non-PNG input, an input over 8 MiB, an
  image over 100,000,000 pixels, and an existing output without --force are all
  refused before the paid fal call.

Limits:
  One image per invocation; there is no directory mode and no --model switch.
  The downloaded result must be a PNG no larger than 32 MiB.
  This command calls fal and is billed to your fal account.

Examples:
  chatroom remove-image-background-fal --in tiles/potion.png --out assets/potion.png
`;

export function registerRemoveImageBackgroundFalCommand(program: Command): void {
  program
    .command('remove-image-background-fal')
    .description('Remove an image background with fal.ai BiRefNet and write a transparent PNG')
    .requiredOption('--in <png>', 'Input PNG to cut out')
    .requiredOption('--out <png>', 'Output PNG path for the image with alpha')
    .option('--force', 'Overwrite an existing output and manifest')
    .addHelpText('after', HELP_AFTER)
    .action(async (options: RemoveBackgroundFalCliOptions) => {
      try {
        const { createDefaultRemoveBackgroundFalDeps } =
          await import('./remove-background-fal-deps.js');
        const result = await removeBackgroundFal(
          { in: options.in, out: options.out, force: options.force },
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
