/**
 * Clock Operations — shared dependency interface for time and delays.
 *
 * Wraps Date.now() and setTimeout to make time-dependent code testable.
 * Tests can inject instant or controllable clocks.
 */

export interface ClockOps {
  /** Get current timestamp in milliseconds */
  now: () => number;
  /** Async delay (wraps setTimeout) */
  delay: (ms: number) => Promise<void>;
}
