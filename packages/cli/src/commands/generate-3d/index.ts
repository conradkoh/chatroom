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

/** The flags each capability turns into, for the help table. */
const CAPABILITY_FLAGS = [
  { capability: 'prompt', flag: '--prompt' },
  { capability: 'image', flag: '--input-image' },
  { capability: 'rig', flag: '--rig' },
] as const;

/** The flags a known model accepts, for the help table. */
function capabilityLine(model: (typeof GENERATE_3D_MODELS)[number]): string {
  return CAPABILITY_FLAGS.filter(({ capability }) => model.capabilities?.[capability] === true)
    .map(({ flag }) => flag)
    .join(', ');
}

/** `id` padded for the help table, followed by its flags. */
function knownModelLines(): string {
  const width = Math.max(...GENERATE_3D_MODELS.map((model) => model.id.length));
  return GENERATE_3D_MODELS.map(
    (model) => `  ${model.id.padEnd(width)}  ${capabilityLine(model)}`
  ).join('\n');
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
  chatroom generate-3d --prompt "a wooden chest" --out chest.glb
  chatroom generate-3d --input-image ./concept.png --out chest.glb
  chatroom generate-3d --model meshy/v7.1/image-to-3d --input-image ./concept.png --out chest.glb --rig --animation-action-id 0 --confirm-cost

Models:
  Default: fal-ai/trellis-2 (image-to-3D). A prompt on it generates a reference
  image with FLUX 2 Flash first (1024x1024), and that image is bundled with the
  mesh.
  Known ids have a price and a capability check. Unknown ids have neither;
  --rig is still refused for them.
${knownModelLines()}

Rigging and animation:
  Meshy 7.1 only: --model meshy/v7.1/text-to-3d or meshy/v7.1/image-to-3d.
  A real run needs --confirm-cost, after you confirm the priced --dry-run.
  Rigging is verified only for Meshy GLBs and expects a humanoid mesh;
  non-humanoid meshes fail on fal. --animation-action-id takes presets 0-696.

Package:
  <base>.zip holds the master GLB, web/<stem>.web.glb, and manifest.json; the
  reference image at reference/... when one was generated or supplied; and the
  rigged and animation GLBs with their web versions when rigging ran.
  <base>.html is a standalone preview. <base> is <out-stem>-<timestamp>.

Cost:
  List prices as of ${GENERATE_3D_PRICES_AS_OF}, not billed amounts; fal returns no
  billed cost, so check the fal dashboard. An unknown id prints
  "Generation cost unknown".
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
  confirmCost?: boolean | undefined;
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
    confirmCost: options.confirmCost,
    dryRun: options.dryRun,
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
    .option('--model <id>', 'fal endpoint id (default fal-ai/trellis-2); any id is accepted')
    .requiredOption('--out <path>', 'Output GLB path (manifest is written to <path>.json)')
    .option(
      '--platform <name>',
      'Generation platform: fal',
      parsePlatform,
      DEFAULT_GENERATE_3D_PLATFORM
    )
    .option(
      '--prompt <text>',
      'text prompt; with the default model, a reference image is generated first'
    )
    .option(
      '--input-image <path-or-url>',
      'reference image (local file or URL); the image-to-3D input'
    )
    .option('--force', 'replace existing output, package, preview, rig, and clip files')
    .option(
      '--rig',
      'rig with Meshy 7.1 (requires --model meshy/v7.1/...); needs --confirm-cost on a real run'
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
      'extra fal request fields as a JSON object, merged over the model defaults; reserved: prompt, image_url; @file reads JSON from a file'
    )
    .option(
      '--confirm-cost',
      'confirm the priced plan for a real run that rigs or animates (Meshy 7.1 only), after the user confirms the priced dry run; not needed for --dry-run'
    )
    .option(
      '--dry-run',
      'Validate and print the request and the static list-price estimate. No upload or fal generation call is made; FAL_API_KEY is not required'
    )
    .addHelpText('after', HELP_AFTER)
    .action(runGenerate3d);
}
