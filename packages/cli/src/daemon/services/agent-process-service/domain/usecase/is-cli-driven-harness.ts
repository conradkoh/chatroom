import type { AgentHarness } from '@workspace/backend/src/domain/entities/agent.js';
import { getHarnessCapabilities } from '@workspace/backend/src/domain/entities/harness/types.js';

/**
 * True for CLI-driven harnesses, where a person pastes prompts into a terminal.
 *
 * This branch is a deliberate guard, not an accident of history: CLI-driven
 * harnesses are deprecated and will be removed, but while they exist they keep
 * the bounded three-attempt restart ladder instead of the SDK's unbounded one.
 *
 * The harness registry is the source of truth for the split. The discriminator
 * is its `runtimeKind` capability (`'cli'` vs `'sdk'`), not a name list. Native
 * SDK harnesses restart with an unbounded, interval-capped retry ladder;
 * CLI-driven harnesses keep the bounded three-attempt ladder. Unknown or absent
 * harnesses are treated as non-CLI so they take the native retry path rather
 * than silently abandoning a restart that the daemon owns.
 */
export function isCliDrivenHarness(harness: string | undefined | null): boolean {
  if (harness == null) return false;
  const capabilities = getHarnessCapabilities(harness as AgentHarness);
  return capabilities?.runtimeKind === 'cli';
}
