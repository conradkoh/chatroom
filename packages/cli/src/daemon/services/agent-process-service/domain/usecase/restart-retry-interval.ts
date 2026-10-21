import { isCliDrivenHarness } from './is-cli-driven-harness.js';

/** Upper bound for native (SDK) agent-restart retry intervals. */
// Exported as the documented restart-retry contract (tests and docs).
// fallow-ignore-next-line unused-export
export const AGENT_RESTART_RETRY_MAX_INTERVAL_MS = 10 * 60_000;

/** Upper bound for CLI-driven (paste-a-prompt) agent-restart retry intervals. */
// fallow-ignore-next-line unused-export
export const CLI_RESTART_RETRY_MAX_INTERVAL_MS = 30_000;

/**
 * Restart-retry interval cap for a harness.
 *
 * Native SDK harnesses (and unknown harnesses, which the daemon owns) use the
 * 10-minute cap. CLI-driven harnesses keep the older 30-second cap.
 */
export function restartRetryMaxIntervalMs(harness: string | undefined): number {
  return isCliDrivenHarness(harness)
    ? CLI_RESTART_RETRY_MAX_INTERVAL_MS
    : AGENT_RESTART_RETRY_MAX_INTERVAL_MS;
}
