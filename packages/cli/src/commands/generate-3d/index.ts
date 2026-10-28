/**
 * `chatroom generate-3d` — local 3D asset generation command.
 *
 * This command calls a third-party generation API directly and never touches
 * the chatroom backend, so it lives in the no-auth section of the CLI. Heavy
 * imports (the fal SDK) are loaded inside the action to keep CLI startup fast.
 */

import { InvalidArgumentError, type Command } from 'commander';

import type { Generate3dResult } from './generate-3d.js';
import { GENERATE_3D_MODELS, GENERATE_3D_PRICES_AS_OF } from './model-registry.js';

const GENERATE_3D_PLATFORMS = ['fal'] as const;
type Generate3dPlatform = (typeof GENERATE_3D_PLATFORMS)[number];
const DEFAULT_GENERATE_3D_PLATFORM: Generate3dPlatform = 'fal';

function parsePlatform(value: string): Generate3dPlatform {
  if (!GENERATE_3D_PLATFORMS.includes(value as Generate3dPlatform)) {
    throw new InvalidArgumentError(`must be one of ${GENERATE_3D_PLATFORMS.join(', ')}`);
  }
  return value as Generate3dPlatform;
}

function modelIdsFor(kind: 'text' | 'image'): string {
  return GENERATE_3D_MODELS.filter((model) => model.inputKind === kind)
    .map((model) => model.id)
    .join(', ');
}

const HELP_AFTER = `
Examples:
  chatroom generate-3d --platform=fal --model meshy/v7.1/text-to-3d --prompt "a stone knight" --out knight.glb
  chatroom generate-3d --platform=fal --model fal-ai/trellis-2 --input-image ./concept.png --out concept.glb

Allowed models:
  text-to-3D:  ${modelIdsFor('text')}
  image-to-3D: ${modelIdsFor('image')}

Cost lines are list-price estimates as of ${GENERATE_3D_PRICES_AS_OF}: fal returns
no billed cost. Check the fal dashboard for the actual bill.
`;

interface Generate3dCliOptions {
  platform: Generate3dPlatform;
  model: string;
  prompt?: string | undefined;
  inputImage?: string | undefined;
  out: string;
  force?: boolean | undefined;
  dryRun?: boolean | undefined;
}

function printResult(result: Generate3dResult): void {
  console.log(`Generated ${result.outPath}`);
  console.log(`Manifest ${result.manifestPath}`);
  for (const line of result.costLines) console.log(line);
}

/** Run the generator or the dry-run plan; both share the same parsed options. */
async function executeGenerate3d(options: Generate3dCliOptions): Promise<void> {
  if (options.prompt !== undefined && options.inputImage !== undefined) {
    throw new Error('Pass either --prompt or --input-image, not both.');
  }
  // The fal SDK is only needed when the command actually runs; a dry run
  // never requires FAL_API_KEY and never calls fal.
  const { createDefaultGenerate3dDeps } = await import('./deps.js');
  const deps = createDefaultGenerate3dDeps();
  const generateOptions = {
    prompt: options.prompt,
    inputImage: options.inputImage,
    model: options.model,
    out: options.out,
    force: options.force,
  };
  if (options.dryRun === true) {
    const { formatGenerate3dPlan, planGenerate3d } = await import('./generate-3d.js');
    console.log(formatGenerate3dPlan(await planGenerate3d(generateOptions, deps)));
    return;
  }
  const { generate3d } = await import('./generate-3d.js');
  printResult(await generate3d(generateOptions, deps));
}

/** Commander action body: run the generator, report failures on stderr. */
async function runGenerate3d(options: Generate3dCliOptions): Promise<void> {
  try {
    await executeGenerate3d(options);
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

export function registerGenerate3dCommand(program: Command): void {
  program
    .command('generate-3d')
    .description('Generate one 3D mesh (GLB) with a fal model and write a JSON manifest next to it')
    .requiredOption(
      '--model <id>',
      `fal model id (required); allowed: ${GENERATE_3D_MODELS.map((model) => model.id).join(', ')}`
    )
    .requiredOption('--out <path>', 'Output GLB path (manifest is written to <path>.json)')
    .option(
      '--platform <name>',
      'Generation platform: fal',
      parsePlatform,
      DEFAULT_GENERATE_3D_PLATFORM
    )
    .option('--prompt <text>', `Text prompt for a text-to-3D model (${modelIdsFor('text')})`)
    .option(
      '--input-image <path-or-url>',
      `Reference image for an image-to-3D model: local .png, .jpg, or .jpeg (uploaded to fal) or an http(s) URL (${modelIdsFor('image')})`
    )
    .option('--force', 'Overwrite existing output and manifest files')
    .option(
      '--dry-run',
      'Validate and print the request and the static list-price estimate. No upload or fal generation call is made; FAL_API_KEY is not required'
    )
    .addHelpText('after', HELP_AFTER)
    .action(runGenerate3d);
}
