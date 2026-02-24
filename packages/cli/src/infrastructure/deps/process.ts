/**
 * Process Operations — shared dependency interface for OS process management.
 *
 * Wraps process.kill to decouple command handlers from direct OS interactions.
 * Used by onAgentShutdown and onDaemonShutdown for process-group kills.
 */

export interface ProcessOps {
  /** Send a signal to a process (wraps process.kill) */
  kill: (pid: number, signal?: NodeJS.Signals | number) => void;
}
