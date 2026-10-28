/**
 * `chatroom generate-3d` — local 3D asset generation command.
 *
 * This command calls a third-party generation API directly and never touches
 * the chatroom backend, so it lives in the no-auth section of the CLI. Heavy
 * imports (the fal SDK) are loaded inside the action to keep CLI startup fast.
 */

import { readFile, stat } from 'node:fs/promises';

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

/** Commander value parser for a repeatable option: append in the given order. */
function collectRepeatable(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/** Cap for `--input @file`, matching the image command's sidecar limit. */
const MAX_INPUT_BYTES = 1024 * 1024;

/** JSON.parse with the command's error wording. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('--input must be valid JSON.');
  }
}

/** A plain object, not an array or null. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse `--input` JSON and require a plain object. */
function parseInputJson(text: string): Record<string, unknown> {
  const parsed = parseJson(text);
  if (!isJsonObject(parsed)) throw new Error('--input must be a JSON object.');
  return parsed;
}

/** Read the file behind `--input @path`, with the same limits as generate-image. */
async function readInputFile(path: string): Promise<Record<string, unknown>> {
  const stats = await stat(path).catch(() => null);
  if (stats === null) throw new Error(`--input file not found: ${path}`);
  if (!stats.isFile()) throw new Error(`--input file is not a regular file: ${path}`);
  if (stats.size > MAX_INPUT_BYTES) {
    throw new Error(
      `--input file is ${stats.size} bytes; the maximum is ${MAX_INPUT_BYTES} bytes (1 MiB).`
    );
  }
  return parseInputJson(await readFile(path, 'utf8'));
}

/** `--input` accepts inline JSON or `@file`, like `generate-image`. */
async function readExtraInput(
  value: string | undefined
): Promise<Record<string, unknown> | undefined> {
  if (value === undefined) return undefined;
  if (!value.startsWith('@')) return parseInputJson(value);
  return readInputFile(value.slice(1));
}

const HELP_AFTER = `
Examples:
  chatroom generate-3d --platform=fal --model meshy/v7.1/text-to-3d --prompt "a stone knight" --out knight.glb
  chatroom generate-3d --platform=fal --model fal-ai/trellis-2 --input-image ./concept.png --out concept.glb
  chatroom generate-3d --platform=fal --model meshy/v7.1/text-to-3d --prompt "a stone knight" --out knight.glb --rig --animation-action-id 0
  chatroom generate-3d --platform=fal --model meshy/v7.1/text-to-3d --prompt "a stone knight" --out knight.glb --package-dir dist/models

Package:
  Every run writes two files beside --out (or in --package-dir):
    <base>.zip   <stem>.glb, web/<stem>.web.glb (smaller JPEG-textured
                 variant), and manifest.json
    <base>.html  separate preview page of the web variant, GLB embedded
  <base> is <out-stem>-<timestamp>, using the UTC timestamp of the run,
  so --out alone sets the folder and the name.

Rigging uses Meshy (fal-ai/meshy/rigging) and expects a humanoid mesh;
non-humanoid meshes fail on fal. Each --animation-action-id is a Meshy preset id
(0-696) and requires --rig.

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
  rig?: boolean | undefined;
  /** Commander camel-cases `--animation-action-id` to this singular name. */
  animationActionId: string[];
  packageDir?: string | undefined;
  input?: string | undefined;
  dryRun?: boolean | undefined;
}

function printResult(result: Generate3dResult): void {
  console.log(`Generated ${result.outPath}`);
  console.log(`Manifest ${result.manifestPath}`);
  console.log(`Package ${result.zipPath}`);
  console.log(`Preview ${result.htmlPath}`);
  for (const line of result.costLines) console.log(line);
}

/**
 * Map parsed CLI options to the generator. An empty `--animation-action-id`
 * list stays absent so slice 1 calls keep their original shape.
 */
function toGenerate3dOptions(
  options: Generate3dCliOptions,
  extraInput: Record<string, unknown> | undefined
) {
  const base = {
    prompt: options.prompt,
    inputImage: options.inputImage,
    model: options.model,
    out: options.out,
    force: options.force,
    rig: options.rig,
    packageDir: options.packageDir,
    extraInput,
  };
  return options.animationActionId.length > 0
    ? { ...base, animationActionIds: options.animationActionId }
    : base;
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
  const generateOptions = toGenerate3dOptions(options, await readExtraInput(options.input));
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
    .description(
      'Generate one 3D mesh (GLB) with a fal model, plus its JSON manifest and a zip/preview package'
    )
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
      '--rig',
      'Rig the generated mesh with Meshy (fal-ai/meshy/rigging). Humanoid meshes only'
    )
    .option(
      '--animation-action-id <id>',
      'Meshy preset animation id (0-696), repeatable; requires --rig',
      collectRepeatable,
      [] as string[]
    )
    .option(
      '--package-dir <dir>',
      'Directory for the package zip and preview (default: the directory of --out)'
    )
    .option(
      '--input <json|@file>',
      'Extra fal request fields as a JSON object, merged over the model defaults; @file reads JSON from a file'
    )
    .option(
      '--dry-run',
      'Validate and print the request and the static list-price estimate. No upload or fal generation call is made; FAL_API_KEY is not required'
    )
    .addHelpText('after', HELP_AFTER)
    .action(runGenerate3d);
}
