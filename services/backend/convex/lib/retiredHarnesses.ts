/**
 * CLI-spawned harnesses removed from the product. Stored rows that still
 * reference them are purged by the `purgeRetiredCliHarness*` migrations.
 *
 * Keep this module dependency-free so migrations can import it before the
 * schema narrows. Matching is exact and case-sensitive.
 */
export const RETIRED_CLI_HARNESSES = [
  'opencode',
  'pi',
  'cursor',
  'claude',
  'copilot',
  'commandcode',
] as const;

export type RetiredCliHarness = (typeof RETIRED_CLI_HARNESSES)[number];

const RETIRED_SET: ReadonlySet<string> = new Set(RETIRED_CLI_HARNESSES);

/** True only for exact retired CLI harness names. Non-strings are never retired. */
export function isRetiredCliHarness(value: unknown): value is RetiredCliHarness {
  return typeof value === 'string' && RETIRED_SET.has(value);
}

/** Drops items whose `agentHarness` is retired. Returns a new array; input is not mutated. */
export function withoutRetiredHarnesses<T extends { agentHarness: unknown }>(
  items: readonly T[]
): T[] {
  return items.filter((item) => !isRetiredCliHarness(item.agentHarness));
}

/** Drops retired harness names from a list of names. Returns a new array. */
export function withoutRetiredHarnessNames<T>(names: readonly T[]): T[] {
  return names.filter((name) => !isRetiredCliHarness(name));
}
