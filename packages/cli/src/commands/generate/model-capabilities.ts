/**
 * Model capabilities for `chatroom generate-image`.
 *
 * The table records only verified constraints for the models the CLI knows.
 * Prompts and docs must not restate model-specific claims: they point at
 * `--dry-run`, which reads this table. Unknown model ids are passed through
 * unchanged and reported as having no capability data.
 */

export const FLUX_2_FLASH_MODEL = 'fal-ai/flux-2/flash';
export const FLUX_2_FLASH_EDIT_MODEL = 'fal-ai/flux-2/flash/edit';

export type ParamSupport =
  | { support: 'supported'; default?: string; note?: string }
  | { support: 'unsupported'; reason: string };

export interface ModelCapability {
  id: string;
  name: string;
  task: 'text-to-image' | 'image-edit';
  params: Readonly<Record<string, ParamSupport>>;
  notes: readonly string[];
  source: string;
}

const FLASH_SOURCE =
  'https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/flux-2/flash (read 2026-10-24); no negative prompt: https://help.bfl.ai/articles/7734566352-does-flux-2-support-negative-prompting (read 2026-10-24)';
const EDIT_SOURCE =
  'https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/flux-2/flash/edit (read 2026-10-24); no negative prompt: https://help.bfl.ai/articles/7734566352-does-flux-2-support-negative-prompting (read 2026-10-24)';

const MODEL_CAPABILITIES: Readonly<Record<string, ModelCapability>> = {
  [FLUX_2_FLASH_MODEL]: {
    id: FLUX_2_FLASH_MODEL,
    name: 'FLUX 2 Flash',
    task: 'text-to-image',
    params: {
      prompt: { support: 'supported' },
      seed: { support: 'supported' },
      output_format: { support: 'supported' },
      image_size: {
        support: 'supported',
        default: 'landscape_4_3',
        note: 'set one explicit value for every call of a set',
      },
      aspect_ratio: {
        support: 'unsupported',
        reason: `FLUX 2 Flash sizes output with image_size. Pass --input '{"image_size":"landscape_4_3"}' instead.`,
      },
      negative_prompt: {
        support: 'unsupported',
        reason: 'FLUX 2 Flash has no negative prompt; describe what you want in --prompt instead.',
      },
      image_urls: {
        support: 'unsupported',
        reason: 'Text-to-image only; use --model fal-ai/flux-2/flash/edit with --input-image.',
      },
    },
    notes: [
      'FLUX 2 Flash has no camera or perspective parameter; perspective comes only from the prompt.',
      'Same-seed reproducibility is not documented by fal.',
      'Returns PNG without an alpha channel by default.',
    ],
    source: FLASH_SOURCE,
  },
  [FLUX_2_FLASH_EDIT_MODEL]: {
    id: FLUX_2_FLASH_EDIT_MODEL,
    name: 'FLUX 2 Flash (edit)',
    task: 'image-edit',
    params: {
      prompt: { support: 'supported' },
      seed: { support: 'supported' },
      image_urls: {
        support: 'supported',
        note: 'set by --input-image; the CLI sends one image',
      },
      image_size: {
        support: 'supported',
        default: 'square_hd',
        note: 'set one explicit value for every call of a set',
      },
      aspect_ratio: {
        support: 'unsupported',
        reason: `FLUX 2 Flash (edit) sizes output with image_size. Pass --input '{"image_size":"square_hd"}' instead.`,
      },
      negative_prompt: {
        support: 'unsupported',
        reason: 'FLUX 2 Flash has no negative prompt; describe what you want in --prompt instead.',
      },
    },
    notes: [
      'FLUX 2 Flash has no camera or perspective parameter; perspective comes only from the prompt.',
      "Not documented to carry a reference image's perspective over to new content; it may return a modified copy of the input.",
      'Same-seed reproducibility is not documented by fal.',
    ],
    source: EDIT_SOURCE,
  },
};

export function getModelCapability(id: string): ModelCapability | undefined {
  return Object.prototype.hasOwnProperty.call(MODEL_CAPABILITIES, id)
    ? MODEL_CAPABILITIES[id]
    : undefined;
}
