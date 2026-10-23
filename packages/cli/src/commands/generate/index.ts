/**
 * `chatroom generate-image` — local asset generation command.
 *
 * This command calls a third-party generation API directly and never touches
 * the chatroom backend, so it lives in the no-auth section of the CLI. Heavy
 * imports (the fal SDK) are loaded inside the action to keep CLI startup fast.
 */

import { readFile, stat } from 'node:fs/promises';

import { InvalidArgumentError, type Command } from 'commander';

import {
  DEFAULT_GENERATE_IMAGE_PLATFORM,
  DEFAULT_IMAGE_MODEL,
  GENERATE_IMAGE_PLATFORMS,
  generateImage,
  parseInputJson,
} from './image.js';
import type { GenerateImagePlatform, ImageOutputFormat } from './image.js';
import { MAX_SIDECAR_BYTES } from './local-image-common.js';

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

// fallow-ignore-next-line complexity
async function readInputOption(value: string): Promise<Record<string, unknown>> {
  if (!value.startsWith('@')) return parseInputJson(value);
  const path = value.slice(1);
  const stats = await stat(path).catch(() => null);
  if (stats === null) throw new Error(`--input file not found: ${path}`);
  if (!stats.isFile()) throw new Error(`--input file is not a regular file: ${path}`);
  if (stats.size > MAX_SIDECAR_BYTES) {
    throw new Error(
      `--input file is ${stats.size} bytes; the maximum is ${MAX_SIDECAR_BYTES} bytes (1 MiB).`
    );
  }
  return parseInputJson(await readFile(path, 'utf8'));
}

function parseSeed(value: string): number {
  const seed = Number(value);
  if (!Number.isInteger(seed)) {
    throw new InvalidArgumentError('must be an integer');
  }
  return seed;
}

const HELP_AFTER = `
Examples:
  chatroom generate-image --platform=fal --prompt "a hero" --out hero.png
  chatroom generate-image --platform=fal --model fal-ai/moss-image --prompt '{"summary":{"canvas":"single"},"items":[]}' --input '{"image_size":{"width":1024,"height":768},"enable_prompt_expansion":false}' --output-format png --out sheet.png
`;

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
    .option(
      '--model <id>',
      `fal model id. Recommended and default: ${DEFAULT_IMAGE_MODEL}`,
      DEFAULT_IMAGE_MODEL
    )
    .option(
      '--aspect-ratio <ratio>',
      `Aspect ratio, e.g. 1:1, 4:3, 16:9, 9:16 (omitted = model default). Not supported by the default model ${DEFAULT_IMAGE_MODEL}, which uses its own image size`
    )
    .option(
      '--output-format <format>',
      'Output format: png, jpeg, or webp (omitted = model default)',
      parseOutputFormat
    )
    .option('--seed <n>', 'Seed for the random number generator', parseSeed)
    .option(
      '--input <json|@file>',
      'Model-specific JSON input object merged into the fal request; @file reads JSON from a file'
    )
    .option('--force', 'Overwrite existing output and manifest files')
    .addHelpText('after', HELP_AFTER)
    .action(
      async (options: {
        prompt: string;
        out: string;
        platform: GenerateImagePlatform;
        model: string;
        aspectRatio?: string | undefined;
        outputFormat?: ImageOutputFormat | undefined;
        seed?: number | undefined;
        input?: string | undefined;
        force?: boolean | undefined;
      }) => {
        try {
          const input =
            options.input === undefined ? undefined : await readInputOption(options.input);
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
              input,
              force: options.force,
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
