/**
 * SpawnPrompt — a non-empty user-message string ready to be sent to a remote agent.
 *
 * The value-object pattern enforces, at compile time, that no harness ever
 * receives an empty user message. The single factory `createSpawnPrompt` is the
 * only place that decides what to substitute when the caller's raw message is
 * missing or blank, eliminating the duplicated `DEFAULT_TRIGGER_PROMPT`
 * constants and trim-and-fallback expressions that previously lived inside
 * each harness implementation.
 *
 * Why this matters: the backend's `composeInitMessage` returns `''` by design
 * (see `services/backend/prompts/generator.ts` — reserved for future
 * role-specific first messages). Harnesses that have a separate user-message
 * wire field (claude, copilot, pi, opencode-sdk) must therefore guarantee
 * non-emptiness themselves. Routing every spawn through this value object
 * makes that guarantee a property of the type system instead of a
 * remembered-by-each-author convention.
 *
 * The brand has no runtime cost — at runtime a `SpawnPrompt` is just a string.
 */
declare const spawnPromptBrand: unique symbol;
export type SpawnPrompt = string & { readonly [spawnPromptBrand]: true };

/**
 * Default trigger sent when the caller-supplied message is empty.
 *
 * The wording is identical to the constant historically duplicated in the
 * claude/copilot/pi harnesses so the agent's response shape is unchanged
 * across harnesses by this refactor.
 */
export const DEFAULT_TRIGGER_PROMPT =
  'Please read your system prompt carefully and follow the Getting Started instructions.';

/**
 * Construct a `SpawnPrompt` from arbitrary raw input.
 *
 * If the input is `undefined`, `null`, empty, or whitespace-only, returns
 * `DEFAULT_TRIGGER_PROMPT`. Otherwise returns the trimmed input. The result
 * is guaranteed to satisfy `value.trim().length > 0`.
 */
export function createSpawnPrompt(raw: string | undefined | null): SpawnPrompt {
  const trimmed = raw?.trim();
  return (trimmed && trimmed.length > 0 ? trimmed : DEFAULT_TRIGGER_PROMPT) as SpawnPrompt;
}
