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
  GENERATE_IMAGE_PLATFORMS,
  generateImage,
  parseInputJson,
} from './image.js';
import type { GenerateImagePlatform, ImageOutputFormat } from './image.js';
import { MAX_SIDECAR_BYTES } from './local-image-common.js';
import { FLUX_2_FLASH_EDIT_MODEL, FLUX_2_FLASH_MODEL } from './model-capabilities.js';

const OUTPUT_FORMATS: readonly ImageOutputFormat[] = ['png', 'webp'];

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
  chatroom generate-image --platform=fal --model ${FLUX_2_FLASH_MODEL} --prompt "a hero" --out hero.png
  chatroom generate-image --platform=fal --model ${FLUX_2_FLASH_MODEL} --prompt 'pixel-art potion, transparent-friendly flat background' --output-format png --out potion.png
  chatroom generate-image --platform=fal --model ${FLUX_2_FLASH_EDIT_MODEL} --prompt "make the sky stormy" --input-image ./hero.png --out hero-stormy.png

Cost lines are estimates: fal returns no billed cost. The rate is live when
available, otherwise the list price; check the fal dashboard for the actual bill.
`;

interface GenerateImageCliOptions {
  prompt: string;
  out: string;
  platform: GenerateImagePlatform;
  model: string;
  aspectRatio?: string | undefined;
  outputFormat?: ImageOutputFormat | undefined;
  seed?: number | undefined;
  input?: string | undefined;
  inputImage?: string | undefined;
  force?: boolean | undefined;
  dryRun?: boolean | undefined;
}

/** Commander action body: parse input, run the generator, report failures. */
// fallow-ignore-next-line complexity
async function runGenerateImage(options: GenerateImageCliOptions): Promise<void> {
  try {
    const input = options.input === undefined ? undefined : await readInputOption(options.input);
    // The fal SDK is only needed when the command actually runs.
    const { createDefaultGenerateImageDeps } = await import('./deps.js');
    const deps = createDefaultGenerateImageDeps();
    const generateOptions = {
      prompt: options.prompt,
      out: options.out,
      platform: options.platform,
      model: options.model,
      aspectRatio: options.aspectRatio,
      outputFormat: options.outputFormat,
      seed: options.seed,
      input,
      inputImage: options.inputImage,
      force: options.force,
    };
    if (options.dryRun === true) {
      const { formatGenerateImagePlan, planGenerateImage } = await import('./image.js');
      console.log(formatGenerateImagePlan(await planGenerateImage(generateOptions, deps)));
      return;
    }
    const result = await generateImage(generateOptions, deps);
    console.log(`Generated ${result.outPath}`);
    console.log(`Manifest ${result.manifestPath}`);
    for (const line of result.costLines ?? []) console.log(line);
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
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
    .requiredOption(
      '--model <id>',
      `fal model id (required), for example ${FLUX_2_FLASH_MODEL}, or ${FLUX_2_FLASH_EDIT_MODEL} with --input-image`
    )
    .option(
      '--aspect-ratio <ratio>',
      'Aspect ratio for models that take one, e.g. 1:1, 16:9 (omitted = model default). Rejected for models the CLI knows do not support it'
    )
    .option(
      '--output-format <format>',
      'Output format: png or webp (omitted = model default)',
      parseOutputFormat
    )
    .option('--seed <n>', 'Seed for the random number generator', parseSeed)
    .option(
      '--input <json|@file>',
      'Model-specific JSON input object merged into the fal request; @file reads JSON from a file'
    )
    .option(
      '--input-image <path-or-url>',
      `Image to edit: a local .png, .jpg, .jpeg, .webp, or .gif (uploaded to fal) or an http(s) URL. Requires an edit model such as ${FLUX_2_FLASH_EDIT_MODEL}`
    )
    .option('--force', 'Overwrite existing output and manifest files')
    .option(
      '--dry-run',
      'Validate and print the request, the model constraints the CLI knows, and the estimated fal cost. No upload or fal generation call is made; one read-only pricing request may be made when FAL_API_KEY is set (the key is not required)'
    )
    .addHelpText('after', HELP_AFTER)
    .action(runGenerateImage);
}
