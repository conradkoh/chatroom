/**
 * Generate 3D — the allowlist of fal models `chatroom generate-3d` can call.
 *
 * Each model differs in request shape, result shape, and price, so it gets one
 * small spec: an input builder, an output adapter, and a static cost table.
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
  inputKind: Generate3dInputKind;
  /** Public model page, recorded in the manifest. */
  pageUrl: string;
  /** Catalog licence value copied verbatim to the manifest. */
  licenseType: 'commercial';
  /** Build the fal request body. Throws Generate3dError for a missing or invalid input. */
  buildInput(args: {
    prompt?: string | undefined;
    imageUrl?: string | undefined;
  }): Record<string, unknown>;
  /** Pull the GLB URL and texture URLs out of the fal result. Throws if the GLB URL is missing. */
  readOutput(data: unknown): { glbUrl: string; textureUrls: string[] };
  /** Base list price and surcharges for a default request. */
  cost(): { lines: Generate3dCostLine[] };
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
  pageUrl: 'https://fal.ai/models/meshy/v7.1/text-to-3d',
  licenseType: 'commercial',
  buildInput: (args) => ({ prompt: requirePrompts(args.prompt) }),
  readOutput: (data) => meshyOutput(MESHY_TEXT_TO_3D.id, data),
  cost: meshyCost,
};

const MESHY_IMAGE_TO_3D: Generate3dModelSpec = {
  id: 'meshy/v7.1/image-to-3d',
  inputKind: 'image',
  pageUrl: 'https://fal.ai/models/meshy/v7.1/image-to-3d',
  licenseType: 'commercial',
  buildInput: (args) => ({ image_url: requireInputImageUrl(args.imageUrl) }),
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
  pageUrl: 'https://fal.ai/models/fal-ai/hunyuan-3d/v3.1/rapid/text-to-3d',
  licenseType: 'commercial',
  buildInput: (args) => ({ prompt: requirePrompts(args.prompt) }),
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
  pageUrl: 'https://fal.ai/models/fal-ai/trellis-2',
  licenseType: 'commercial',
  buildInput: (args) => ({
    image_url: requireInputImageUrl(args.imageUrl),
    resolution: TRELLIS_2_RESOLUTION,
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

// ─── Allowlist ──────────────────────────────────────────────────────────────

/**
 * The only model ids `generate-3d` accepts. Adding one here is the whole
 * change; there is deliberately no free-form model passthrough in v1.
 */
export const GENERATE_3D_MODELS: readonly Generate3dModelSpec[] = [
  MESHY_TEXT_TO_3D,
  HUNYUAN_RAPID_TEXT_TO_3D,
  MESHY_IMAGE_TO_3D,
  TRELLIS_2,
];

export function findGenerate3dModel(id: string): Generate3dModelSpec | undefined {
  return GENERATE_3D_MODELS.find((model) => model.id === id);
}

export function allowedGenerate3dModelIds(): string[] {
  return GENERATE_3D_MODELS.map((model) => model.id);
}
