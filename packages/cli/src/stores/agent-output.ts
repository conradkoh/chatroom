/**
 * Agent Output Store
 *
 * Tracks the last output timestamp for each agent (identified by chatroomId:role).
 * Used for idle detection — if an agent has produced no output for a threshold
 * duration, it can be considered stale and cleaned up.
 *
 * This store is in-memory only and resets when the daemon restarts.
 */

export class AgentOutputStore {
  private lastOutput = new Map<string, number>();

  private key(chatroomId: string, role: string): string {
    return `${chatroomId}:${role}`;
  }

  /**
   * Record that output was received from an agent.
   * Updates the last output timestamp to the current time.
   */
  recordOutput(chatroomId: string, role: string): void {
    this.lastOutput.set(this.key(chatroomId, role), Date.now());
  }

  /**
   * Get the last output timestamp for an agent.
   * Returns undefined if the agent has never produced output.
   */
  getLastOutputTimestamp(chatroomId: string, role: string): number | undefined {
    return this.lastOutput.get(this.key(chatroomId, role));
  }

  /**
   * Check if an agent has been idle (no output) beyond the threshold.
   * Returns false if the agent has never produced output (just started).
   */
  isIdle(chatroomId: string, role: string, thresholdMs: number): boolean {
    const last = this.lastOutput.get(this.key(chatroomId, role));
    if (last === undefined) return false; // Never seen output = not idle (just started)
    return Date.now() - last > thresholdMs;
  }

  /**
   * Get all agents currently being tracked.
   */
  getTrackedAgents(): { chatroomId: string; role: string; lastOutputAt: number }[] {
    return Array.from(this.lastOutput.entries()).map(([key, ts]) => {
      const lastIdx = key.lastIndexOf(':');
      const chatroomId = key.substring(0, lastIdx);
      const role = key.substring(lastIdx + 1);
      return { chatroomId, role, lastOutputAt: ts };
    });
  }

  /**
   * Stop tracking an agent (call on exit/cleanup).
   */
  remove(chatroomId: string, role: string): void {
    this.lastOutput.delete(this.key(chatroomId, role));
  }
}
