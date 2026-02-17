/**
 * Process Operations — shared dependency interface for OS process management.
 *
 * Wraps process.kill and PID verification to decouple command handlers
 * from direct OS interactions. Used across multiple commands for testability.
 */

export interface ProcessOps {
  /** Send a signal to a process (wraps process.kill) */
  kill: (pid: number, signal?: NodeJS.Signals | number) => void;
  /** Verify a PID belongs to the expected harness */
  verifyPidOwnership: (pid: number, expectedHarness?: string) => boolean;
}
