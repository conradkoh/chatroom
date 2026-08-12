/**
 * Server-side model catalog (SSOT) for harnesses whose model lists cannot be
 * enumerated locally — the Codex SDK stub (`[]`), hard-coded CLI lists (copilot,
 * legacy cursor), etc.
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
import { expandCursorModelVariantCatalog, type CursorBaseModelId } from './cursor.model-variants';
import { expandModelVariantCatalog } from './model-variant';

/** Harness ids with a server-curated catalog. */
export type CatalogBackedHarness = Extract<
  AgentHarness,
  'codex-sdk' | 'copilot' | 'cursor' | 'claude' | 'claude-sdk'
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

export type CursorModelVariantString = CursorBaseModelId | `${CursorBaseModelId}[${string}]`;

/* const CURSOR_LEGACY_MODEL_SLUGS = [
  'claude-4.6-opus-high',
  'claude-4.6-opus-high-thinking',
  'claude-4.6-opus-max',
  'claude-4.6-opus-max-thinking',
  'claude-4.5-opus-high',
  'claude-4.5-opus-high-thinking',
  'claude-4.6-sonnet-medium',
  'claude-4.6-sonnet-medium-thinking',
  'claude-4.5-sonnet',
  'claude-4.5-sonnet-thinking',
  'claude-4-sonnet',
  'claude-4-sonnet-thinking',
  'claude-4-sonnet-1m',
  'claude-4-sonnet-1m-thinking',
  'gpt-5.4-low',
  'gpt-5.4-medium',
  'gpt-5.4-medium-fast',
  'gpt-5.4-high',
  'gpt-5.4-high-fast',
  'gpt-5.4-xhigh',
  'gpt-5.4-xhigh-fast',
  'gpt-5.3-codex-low',
  'gpt-5.3-codex-low-fast',
  'gpt-5.3-codex',
  'gpt-5.3-codex-fast',
  'gpt-5.3-codex-high',
  'gpt-5.3-codex-high-fast',
  'gpt-5.3-codex-xhigh',
  'gpt-5.3-codex-xhigh-fast',
  'gpt-5.3-codex-spark-preview',
  'gpt-5.2',
  'gpt-5.2-high',
  'gpt-5.2-codex-low',
  'gpt-5.2-codex-low-fast',
  'gpt-5.2-codex',
  'gpt-5.2-codex-fast',
  'gpt-5.2-codex-high',
  'gpt-5.2-codex-high-fast',
  'gpt-5.2-codex-xhigh',
  'gpt-5.2-codex-xhigh-fast',
  'gpt-5.1-high',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-max-high',
  'gpt-5.1-codex-mini',
  'gemini-3.1-pro',
  'gemini-3-pro',
  'gemini-3-flash',
  'grok',
  'kimi-k2.5',
  'auto',
  'composer-2.5',
  'composer-2',
  'composer-1.5',
  'composer-1',
] as const;

function cursorModelVariants(): CursorModelVariantString[] {
  return expandCursorModelVariantCatalog() as CursorModelVariantString[];
}
*/

function cursorModelVariants(): CursorModelVariantString[] {
  return expandCursorModelVariantCatalog() as CursorModelVariantString[];
}

// ─── Catalog ────────────────────────────────────────────────────────────────

export const HARNESS_MODEL_CATALOG: Record<CatalogBackedHarness, readonly string[]> = {
  'codex-sdk': codexModelVariants(),
  copilot: [
    // Moved from packages/cli copilot-agent-service.ts — GitHub controls this
    // model set server-side, so it is curated here rather than hard-coded in
    // every CLI install.
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
  cursor: cursorModelVariants(),
  claude: claudeModelVariants(),
  'claude-sdk': claudeModelVariants(),
  /* cursor: [
    // Moved from packages/cli cursor-agent-service.ts CURSOR_MODELS.
    // Anthropic Claude
    'claude-4.6-opus-high',
    'claude-4.6-opus-high-thinking',
    'claude-4.6-opus-max',
    'claude-4.6-opus-max-thinking',
    'claude-4.5-opus-high',
    'claude-4.5-opus-high-thinking',
    'claude-4.6-sonnet-medium',
    'claude-4.6-sonnet-medium-thinking',
    'claude-4.5-sonnet',
    'claude-4.5-sonnet-thinking',
    'claude-4-sonnet',
    'claude-4-sonnet-thinking',
    'claude-4-sonnet-1m',
    'claude-4-sonnet-1m-thinking',
    // OpenAI GPT-5.4
    'gpt-5.4-low',
    'gpt-5.4-medium',
    'gpt-5.4-medium-fast',
    'gpt-5.4-high',
    'gpt-5.4-high-fast',
    'gpt-5.4-xhigh',
    'gpt-5.4-xhigh-fast',
    // OpenAI GPT-5.3 Codex
    'gpt-5.3-codex-low',
    'gpt-5.3-codex-low-fast',
    'gpt-5.3-codex',
    'gpt-5.3-codex-fast',
    'gpt-5.3-codex-high',
    'gpt-5.3-codex-high-fast',
    'gpt-5.3-codex-xhigh',
    'gpt-5.3-codex-xhigh-fast',
    'gpt-5.3-codex-spark-preview',
    // OpenAI GPT-5.2
    'gpt-5.2',
    'gpt-5.2-high',
    'gpt-5.2-codex-low',
    'gpt-5.2-codex-low-fast',
    'gpt-5.2-codex',
    'gpt-5.2-codex-fast',
    'gpt-5.2-codex-high',
    'gpt-5.2-codex-high-fast',
    'gpt-5.2-codex-xhigh',
    'gpt-5.2-codex-xhigh-fast',
    // OpenAI GPT-5.1
    'gpt-5.1-high',
    'gpt-5.1-codex-max',
    'gpt-5.1-codex-max-high',
    'gpt-5.1-codex-mini',
    // Google Gemini
    'gemini-3.1-pro',
    'gemini-3-pro',
    'gemini-3-flash',
    // Other
    'grok',
    'kimi-k2.5',
    // Cursor built-in
    'auto',
    'composer-2.5',
    'composer-2',
    'composer-1.5',
    'composer-1',
  ], */
};
