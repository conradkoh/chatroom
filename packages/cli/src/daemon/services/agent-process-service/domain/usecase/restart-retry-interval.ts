/** Upper bound for native (SDK) agent-restart retry intervals. */
// Exported as the documented restart-retry contract (tests and docs).
// fallow-ignore-next-line unused-export
export const AGENT_RESTART_RETRY_MAX_INTERVAL_MS = 10 * 60_000;

/** Upper bound for CLI-driven (paste-a-prompt) agent-restart retry intervals. */
// fallow-ignore-next-line unused-export
export const CLI_RESTART_RETRY_MAX_INTERVAL_MS = 30_000;

/**
 * Restart-retry interval cap for a respawn request.
 *
 * The caller decides `cliDriven` once from `isCliDrivenHarness` and recomputes
 * it when configuration changes, so both the cap and the CLI attempt bound come
 * from that single field. SDK harnesses (and unknown harnesses, which the
 * daemon owns) use the 10-minute cap; CLI-driven harnesses keep 30 seconds.
 */
export function restartRetryMaxIntervalMs(cliDriven: boolean): number {
  return cliDriven ? CLI_RESTART_RETRY_MAX_INTERVAL_MS : AGENT_RESTART_RETRY_MAX_INTERVAL_MS;
}
