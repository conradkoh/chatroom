/**
 * `chatroom generate-image` — local asset generation command.
 *
 * This command calls a third-party generation API directly and never touches
 * the chatroom backend, so it lives in the no-auth section of the CLI. Heavy
 * imports (the fal SDK) are loaded inside the action to keep CLI startup fast.
 */

import { InvalidArgumentError, type Command } from 'commander';

import {
  DEFAULT_ASPECT_RATIO,
  DEFAULT_GENERATE_IMAGE_PLATFORM,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_OUTPUT_FORMAT,
  GENERATE_IMAGE_PLATFORMS,
  generateImage,
} from './image.js';
import type { GenerateImagePlatform, ImageOutputFormat } from './image.js';

const OUTPUT_FORMATS: readonly ImageOutputFormat[] = ['png', 'jpeg', 'webp'];

function parsePlatform(value: string): GenerateImagePlatform {
  if (!GENERATE_IMAGE_PLATFORMS.includes(value as GenerateImagePlatform)) {
    throw new InvalidArgumentError(`must be one of ${GENERATE_IMAGE_PLATFORMS.join(', ')}`);
  }
  return value as GenerateImagePlatform;
}

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

export function registerGenerateImageCommand(program: Command): void {
  program
    .command('generate-image')
    .description('Generate one image with a fal model and write a JSON manifest next to it')
    .requiredOption('--prompt <text>', 'Text prompt describing the image')
    .requiredOption('--out <path>', 'Output image path (manifest is written to <path>.json)')
    .option(
      '--platform <name>',
      'Generation platform: fal',
      parsePlatform,
      DEFAULT_GENERATE_IMAGE_PLATFORM
    )
    .option('--model <id>', 'Model id on the selected platform', DEFAULT_IMAGE_MODEL)
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
        platform: GenerateImagePlatform;
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
              platform: options.platform,
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
