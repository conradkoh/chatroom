/**
 * Generate 3D — the known fal models and the generic passthrough.
 *
 * Any fal endpoint id is accepted by `chatroom generate-3d`. The ids below have
 * a specialised adapter: an input builder that sends the fields the model
 * expects, an output adapter that knows where its GLB lives, and a static cost
 * table. Every other id goes through a generic spec that maps `--prompt` to
 * `prompt`, `--input-image` to `image_url`, merges `--input`, and finds the GLB
 * by shape.
 *
 * Nothing here touches the network; the adapters receive the raw fal result and
 * narrow it themselves.
 *
 * Prices were read from the public fal model pages on
 * {@link GENERATE_3D_PRICES_AS_OF}. They are list prices, not a billed amount:
 * fal returns no billed cost, and this command has no live price lookup.
 */

/** Date the list prices below were read from fal's public model pages. */
export const GENERATE_3D_PRICES_AS_OF = '2026-10-27';

/**
 * Error type for generate-3d failures. Messages may name the model, the
 * request id, and the GLB URL (so a paid result can be recovered) but never the
 * API key.
 */
export class Generate3dError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Generate3dError';
  }
}

/** Which dedicated input flag a model accepts. */
export type Generate3dInputKind = 'text' | 'image';

/**
 * What a registered model can do, checked before any paid call. A model the
 * registry does not know has no capabilities, so its flags are passed through
 * and fal validates them.
 */
export interface Generate3dCapabilities {
  /** The model takes `--prompt`. */
  prompt: boolean;
  /** The model takes `--input-image`. */
  image: boolean;
  /** The model's GLB can be rigged with Meshy. */
  rig: boolean;
}

export interface Generate3dCostLine {
  /** Human-readable charge, including its list price. */
  label: string;
  /**
   * USD this line adds to the estimated total. Optional surcharges that were
   * not requested carry `0` so the total stays the requested-request price.
   */
  usd: number;
}

export interface Generate3dModelSpec {
  /** fal endpoint id, passed to fal.subscribe unchanged. */
  id: string;
  /** Which dedicated input flag the model takes; absent for an unknown model. */
  inputKind?: Generate3dInputKind | undefined;
  /** What the model accepts; absent for an unknown model, which skips checks. */
  capabilities?: Generate3dCapabilities | undefined;
  /** Public model page, recorded in the manifest. */
  pageUrl: string;
  /** Catalog licence value copied verbatim to the manifest. */
  licenseType: 'commercial';
  /**
   * Build the fal request body. Throws Generate3dError for a missing or invalid
   * input. `extraInput` (`--input`) is merged last, over the adapter's defaults.
   */
  buildInput(args: {
    prompt?: string | undefined;
    imageUrl?: string | undefined;
    extraInput?: Record<string, unknown> | undefined;
  }): Record<string, unknown>;
  /** Pull the GLB URL and texture URLs out of the fal result. Throws if the GLB URL is missing. */
  readOutput(data: unknown): { glbUrl: string; textureUrls: string[] };
  /**
   * Base list price and surcharges for a default request, or undefined when the
   * registry has no price data for the model. Never a guess.
   */
  cost(): { lines: Generate3dCostLine[] } | undefined;
}

// ─── result helpers ─────────────────────────────────────────────────────────

/** Shared guard: fal results and request helpers are plain JSON objects. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The `url` of a fal `File` object, or undefined when the field is absent. */
export function fileUrl(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const url = value.url;
  return typeof url === 'string' && url.trim().length > 0 ? url : undefined;
}

/** A model without a GLB cannot satisfy the command's output contract. */
function missingGlb(modelId: string): Generate3dError {
  return new Generate3dError(`fal returned no GLB for model ${modelId}. Nothing was written.`);
}

function requirePrompts(prompt: string | undefined): string {
  const text = prompt?.trim() ?? '';
  if (text.length === 0) {
    throw new Generate3dError('--prompt must not be empty for a text-to-3D model.');
  }
  return text;
}

function requireInputImageUrl(imageUrl: string | undefined): string {
  const url = imageUrl?.trim() ?? '';
  if (url.length === 0) {
    throw new Generate3dError('--input-image is required for an image-to-3D model.');
  }
  return url;
}

// ─── Meshy v7.1 ─────────────────────────────────────────────────────────────

/**
 * Meshy's `texture_urls[]` entries hold up to four fal `File` objects (base
 * colour plus optional PBR maps). Flatten them in a stable order, skipping
 * absent maps.
 */
const MESHY_TEXTURE_KEYS = ['base_color', 'normal', 'roughness', 'metallic'] as const;

/** The `url`s of the texture files in one Meshy `texture_urls[]` entry. */
function meshyEntryTextureUrls(entry: unknown): string[] {
  if (!isRecord(entry)) return [];
  return MESHY_TEXTURE_KEYS.map((key) => fileUrl(entry[key])).filter(
    (url): url is string => url !== undefined
  );
}

function meshyTextureUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(meshyEntryTextureUrls);
}

function meshyOutput(modelId: string, data: unknown): { glbUrl: string; textureUrls: string[] } {
  if (!isRecord(data)) throw missingGlb(modelId);
  const glbUrl = fileUrl(data.model_glb);
  if (glbUrl === undefined) throw missingGlb(modelId);
  return { glbUrl, textureUrls: meshyTextureUrls(data.texture_urls) };
}

/**
 * Meshy v7.1 bills $0.80 for untextured geometry and $1.20 for a textured
 * model. `mode` defaults to `full` (textured), so the request is textured and
 * the textures surcharge is part of the total.
 */
function meshyCost(): { lines: Generate3dCostLine[] } {
  return {
    lines: [
      { label: 'base $0.80', usd: 0.8 },
      { label: 'textures +$0.40', usd: 0.4 },
    ],
  };
}

const MESHY_TEXT_TO_3D: Generate3dModelSpec = {
  id: 'meshy/v7.1/text-to-3d',
  inputKind: 'text',
  capabilities: { prompt: true, image: false, rig: true },
  pageUrl: 'https://fal.ai/models/meshy/v7.1/text-to-3d',
  licenseType: 'commercial',
  buildInput: (args) => ({ prompt: requirePrompts(args.prompt), ...args.extraInput }),
  readOutput: (data) => meshyOutput(MESHY_TEXT_TO_3D.id, data),
  cost: meshyCost,
};

const MESHY_IMAGE_TO_3D: Generate3dModelSpec = {
  id: 'meshy/v7.1/image-to-3d',
  inputKind: 'image',
  capabilities: { prompt: false, image: true, rig: true },
  pageUrl: 'https://fal.ai/models/meshy/v7.1/image-to-3d',
  licenseType: 'commercial',
  buildInput: (args) => ({ image_url: requireInputImageUrl(args.imageUrl), ...args.extraInput }),
  readOutput: (data) => meshyOutput(MESHY_IMAGE_TO_3D.id, data),
  cost: meshyCost,
};

// ─── Hunyuan 3D v3.1 rapid ──────────────────────────────────────────────────

/**
 * Hunyuan rapid requires only `prompt`; `enable_geometry` and `enable_pbr`
 * default to false, so the request returns a textured GLB without PBR maps.
 * The result puts the GLB under `model_urls.glb` (not `model_glb`).
 */
const HUNYUAN_RAPID_TEXT_TO_3D: Generate3dModelSpec = {
  id: 'fal-ai/hunyuan-3d/v3.1/rapid/text-to-3d',
  inputKind: 'text',
  // Rigging is only verified against Meshy GLBs, so Hunyuan output is not
  // offered the rig flag rather than failing after a paid call.
  capabilities: { prompt: true, image: false, rig: false },
  pageUrl: 'https://fal.ai/models/fal-ai/hunyuan-3d/v3.1/rapid/text-to-3d',
  licenseType: 'commercial',
  buildInput: (args) => ({ prompt: requirePrompts(args.prompt), ...args.extraInput }),
  readOutput: (data) => {
    if (!isRecord(data)) throw missingGlb(HUNYUAN_RAPID_TEXT_TO_3D.id);
    const modelUrls = isRecord(data.model_urls) ? data.model_urls : {};
    const glbUrl = fileUrl(modelUrls.glb);
    if (glbUrl === undefined) throw missingGlb(HUNYUAN_RAPID_TEXT_TO_3D.id);
    const textureUrls = [fileUrl(modelUrls.texture), fileUrl(data.texture)].filter(
      (url): url is string => url !== undefined
    );
    return { glbUrl, textureUrls: [...new Set(textureUrls)] };
  },
  cost: () => ({
    lines: [
      { label: 'base $0.225', usd: 0.225 },
      // The CLI does not request PBR in v1, so this surcharge is never billed.
      { label: 'PBR +$0.15 (optional; not requested, excluded from the total)', usd: 0 },
    ],
  }),
};

// ─── Trellis-2 ──────────────────────────────────────────────────────────────

/**
 * Trellis-2's schema defaults `resolution` to 1024, which is the $0.30 tier.
 * It is sent explicitly so a future schema-default change cannot silently move
 * the cost without changing this adapter.
 */
const TRELLIS_2_RESOLUTION = 1024;

/**
 * Trellis-2 returns a GLB only; its textures are embedded in that file, so
 * there are no separate texture URLs to record.
 */
const TRELLIS_2: Generate3dModelSpec = {
  id: 'fal-ai/trellis-2',
  inputKind: 'image',
  capabilities: { prompt: false, image: true, rig: false },
  pageUrl: 'https://fal.ai/models/fal-ai/trellis-2',
  licenseType: 'commercial',
  buildInput: (args) => ({
    image_url: requireInputImageUrl(args.imageUrl),
    resolution: TRELLIS_2_RESOLUTION,
    ...args.extraInput,
  }),
  readOutput: (data) => {
    if (!isRecord(data)) throw missingGlb(TRELLIS_2.id);
    const glbUrl = fileUrl(data.model_glb);
    if (glbUrl === undefined) throw missingGlb(TRELLIS_2.id);
    return { glbUrl, textureUrls: [] };
  },
  // $0.25 at 512, $0.30 at 1024, $0.35 at 1536.
  cost: () => ({ lines: [{ label: `resolution ${TRELLIS_2_RESOLUTION} $0.30`, usd: 0.3 }] }),
};

// ─── Known models ───────────────────────────────────────────────────────────

/**
 * The ids with a specialised adapter. This is a capability table for help text
 * and validation, not an allowlist: every other fal id goes through the generic
 * passthrough below.
 */
export const GENERATE_3D_MODELS: readonly Generate3dModelSpec[] = [
  MESHY_TEXT_TO_3D,
  HUNYUAN_RAPID_TEXT_TO_3D,
  MESHY_IMAGE_TO_3D,
  TRELLIS_2,
];

// ─── Generic passthrough ────────────────────────────────────────────────────

/** A GLB URL, with or without a query string or fragment. */
const GLB_URL_PATTERN = /^https?:\/\/\S+\.glb(?:[?#]\S*)?$/i;

/** The values to search in order: array items, or an object's values. */
function childValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  return Object.values(value);
}

/** The first `.glb` URL anywhere in a fal result, in key order. */
function findGlbUrlDeep(value: unknown): string | undefined {
  if (typeof value === 'string') return GLB_URL_PATTERN.test(value) ? value : undefined;
  return childValues(value)
    .map(findGlbUrlDeep)
    .find((url) => url !== undefined);
}

/** The GLB in the two conventional fal fields, if either is present. */
function conventionalGlbUrl(data: Record<string, unknown>): string | undefined {
  const modelUrls = isRecord(data['model_urls']) ? data['model_urls'] : {};
  return fileUrl(data['model_glb']) ?? fileUrl(modelUrls['glb']);
}

/** A no-GLB error that lists the top-level keys, so a field guess is cheap. */
function missingGlbWithKeys(id: string, data: Record<string, unknown>): Generate3dError {
  const keys = Object.keys(data).join(', ') || '(none)';
  return new Generate3dError(
    `fal returned no GLB for model ${id}. Top-level result keys: ${keys}. Nothing was written.`
  );
}

/**
 * The GLB for a model the registry does not know: the two conventional fields
 * first, then any `.glb` URL in the result. The caller appends the request id to
 * this error.
 */
function genericOutput(id: string, data: unknown): { glbUrl: string; textureUrls: string[] } {
  if (!isRecord(data)) throw missingGlb(id);
  const glbUrl = conventionalGlbUrl(data) ?? findGlbUrlDeep(data);
  if (glbUrl === undefined) throw missingGlbWithKeys(id, data);
  return { glbUrl, textureUrls: [] };
}

/** A spec for any fal id the registry has no adapter for. */
function genericSpec(id: string): Generate3dModelSpec {
  return {
    id,
    pageUrl: `https://fal.ai/models/${id}`,
    licenseType: 'commercial',
    buildInput: (args) => ({
      ...(args.prompt === undefined ? {} : { prompt: args.prompt.trim() }),
      ...(args.imageUrl === undefined ? {} : { image_url: args.imageUrl }),
      ...args.extraInput,
    }),
    readOutput: (data) => genericOutput(id, data),
    cost: () => undefined,
  };
}

/**
 * The spec for `id`: the registered adapter when there is one, otherwise the
 * generic passthrough. There is no rejection path — fal validates the id.
 */
export function resolveGenerate3dModel(id: string): Generate3dModelSpec {
  return GENERATE_3D_MODELS.find((model) => model.id === id) ?? genericSpec(id);
}
