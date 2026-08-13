/**
 * Server-side model catalog (SSOT) for harnesses whose model lists cannot be
 * enumerated locally — the Codex SDK stub (`[]`), hard-coded CLI lists (copilot),
 * etc.
 *
 * Cursor (`cursor`, `cursor-sdk`) models are discovered at runtime via
 * `Cursor.models.list()` in the daemon — not curated here.
 *
 * The daemon fetches these lists at boot and on manual refresh via
 * `api.harnesses.<harness>.listModels`; the CLI never embeds this data. Updating
 * a list here reaches every daemon on its next refresh — no CLI release needed.
 *
 * Entries are model variant strings (see `model-variant.ts`): plain ids for
 * default behavior plus every variant combination, e.g.
 * `'gpt-5.6-terra[reasoning=high]'`.
 */

import type { AgentHarness } from '../agent';
import {
  CLAUDE_CATALOG_BASE_MODEL_IDS,
  CLAUDE_MODEL_VARIANT_COMBINATIONS,
} from './claude.model-variants';
import {
  CODEX_MODEL_VARIANT_COMBINATIONS,
  type CodexReasoningLevel,
} from './codex-sdk.model-variants';
import { expandModelVariantCatalog } from './model-variant';

/** Harness ids with a server-curated catalog. */
export type CatalogBackedHarness = Extract<
  AgentHarness,
  'codex-sdk' | 'copilot' | 'claude' | 'claude-sdk'
>;
const claudeModelVariants = () =>
  expandModelVariantCatalog(CLAUDE_CATALOG_BASE_MODEL_IDS, CLAUDE_MODEL_VARIANT_COMBINATIONS);

// ─── Codex variants (typed template strings — catalog entries are compile-checked) ───

/**
 * Codex model ids offered in the catalog.
 * Source: the Codex CLI's model catalog (cache: `~/.codex/models_cache.json`).
 */
export type CodexModelId =
  'gpt-5.6-terra' | 'gpt-5.6-luna' | 'gpt-5.6-sol' | 'gpt-5.5' | 'gpt-5.4-mini';

/** Every valid codex variant string: plain id, or id with a reasoning level. */
export type CodexModelVariantString =
  CodexModelId | `${CodexModelId}[reasoning=${CodexReasoningLevel}]`;

const CODEX_MODEL_IDS: readonly CodexModelId[] = [
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.6-sol',
  'gpt-5.5',
  'gpt-5.4-mini',
];

/**
 * Plain id (harness default) + one entry per reasoning level, including
 * `reasoning=none` for explicitly opting out of a reasoning level.
 */
function codexModelVariants(): CodexModelVariantString[] {
  return expandModelVariantCatalog(
    CODEX_MODEL_IDS,
    CODEX_MODEL_VARIANT_COMBINATIONS
  ) as CodexModelVariantString[];
}

// ─── Catalog ────────────────────────────────────────────────────────────────

export const HARNESS_MODEL_CATALOG: Record<CatalogBackedHarness, readonly string[]> = {
  'codex-sdk': codexModelVariants(),
  copilot: [
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-haiku-4.5',
    'claude-sonnet-4-6',
    'claude-opus-4-6',
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gemini-3-pro-preview',
    'gemini-2-5-flash',
  ],
  claude: claudeModelVariants(),
  'claude-sdk': claudeModelVariants(),
};
