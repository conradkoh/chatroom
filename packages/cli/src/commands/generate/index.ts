/**
 * `chatroom generate` — local asset generation commands.
 *
 * These commands call third-party generation APIs directly and never touch the
 * chatroom backend, so they live in the no-auth section of the CLI. Heavy
 * imports (the fal SDK) are loaded inside the action to keep CLI startup fast.
 */

import { InvalidArgumentError, type Command } from 'commander';

import {
  DEFAULT_ASPECT_RATIO,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_OUTPUT_FORMAT,
  generateImage,
} from './image.js';
import type { ImageOutputFormat } from './image.js';

const OUTPUT_FORMATS: readonly ImageOutputFormat[] = ['png', 'jpeg', 'webp'];

function parseOutputFormat(value: string): ImageOutputFormat {
  if (!OUTPUT_FORMATS.includes(value as ImageOutputFormat)) {
    throw new InvalidArgumentError(`must be one of ${OUTPUT_FORMATS.join(', ')}`);
  }
  return value as ImageOutputFormat;
}

function parseSeed(value: string): number {
  const seed = Number(value);
  if (!Number.isInteger(seed)) {
    throw new InvalidArgumentError('must be an integer');
  }
  return seed;
}

export function registerGenerateCommand(program: Command): void {
  const generateCommand = program
    .command('generate')
    .description('Generate local assets (no chatroom auth required)');

  generateCommand
    .command('image')
    .description('Generate one image with a fal model and write a JSON manifest next to it')
    .requiredOption('--prompt <text>', 'Text prompt describing the image')
    .requiredOption('--out <path>', 'Output image path (manifest is written to <path>.json)')
    .option('--model <id>', 'fal model id', DEFAULT_IMAGE_MODEL)
    .option(
      '--aspect-ratio <ratio>',
      'Aspect ratio, e.g. 1:1, 4:3, 16:9, 9:16',
      DEFAULT_ASPECT_RATIO
    )
    .option(
      '--output-format <format>',
      'Output format: png, jpeg, or webp',
      parseOutputFormat,
      DEFAULT_OUTPUT_FORMAT
    )
    .option('--seed <n>', 'Seed for the random number generator', parseSeed)
    .action(
      async (options: {
        prompt: string;
        out: string;
        model: string;
        aspectRatio: string;
        outputFormat: ImageOutputFormat;
        seed?: number | undefined;
      }) => {
        try {
          // The fal SDK is only needed when the command actually runs.
          const { createDefaultGenerateImageDeps } = await import('./deps.js');
          const result = await generateImage(
            {
              prompt: options.prompt,
              out: options.out,
              model: options.model,
              aspectRatio: options.aspectRatio,
              outputFormat: options.outputFormat,
              seed: options.seed,
            },
            createDefaultGenerateImageDeps()
          );
          console.log(`Generated ${result.outPath}`);
          console.log(`Manifest ${result.manifestPath}`);
        } catch (err) {
          console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
          process.exitCode = 1;
        }
      }
    );
}
