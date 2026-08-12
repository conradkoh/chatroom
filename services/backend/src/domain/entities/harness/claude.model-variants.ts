import type { ModelVariantSchema } from './model-variant';
export const CLAUDE_EFFORT_VALUES = ['none','low','medium','high','xhigh','max'] as const;
export const CLAUDE_MODEL_VARIANT_COMBINATIONS = [{}, ...CLAUDE_EFFORT_VALUES.map((effort) => ({ effort }))] as const satisfies ModelVariantSchema;
export const CLAUDE_BASE_MODEL_IDS = ['opus','sonnet','haiku','claude-opus-4-8','claude-opus-4-6','claude-sonnet-4-6','claude-haiku-4-5'] as const;
