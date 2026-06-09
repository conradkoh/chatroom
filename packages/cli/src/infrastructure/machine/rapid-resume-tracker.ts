import type {
  ResumeStormCheck,
  ResumeStormTracker,
} from '../../domain/agent-lifecycle/ports/resume-storm-tracker.js';

/**
 * RapidResumeTracker — detects agent_end storms during in-process auto-resume.
 *
 * When an agent completes turns in quick succession without blocking on
 * get-next-task, the daemon should stop resume injection and mark the agent
 * as stopped.
 */

/** Sliding window for counting turn-end events. */
const RAPID_RESUME_WINDOW_MS = 30_000;

/** agent_end count within the window that triggers abort. */
const RAPID_RESUME_THRESHOLD = 5;

export class RapidResumeTracker implements ResumeStormTracker {
  private readonly history = new Map<string, number[]>();

  /**
   * Record an agent_end and check whether auto-resume should abort.
   */
  record(
    chatroomId: string,
    role: string,
    now: number = Date.now()
  ): ResumeStormCheck & {
    recentEnds: number[];
  } {
    const key = `${chatroomId}:${role.toLowerCase()}`;
    const windowStart = now - RAPID_RESUME_WINDOW_MS;
    const recent = (this.history.get(key) ?? []).filter((ts) => ts >= windowStart);
    recent.push(now);
    this.history.set(key, recent);

    return {
      isStorm: recent.length >= RAPID_RESUME_THRESHOLD,
      recentEnds: recent,
      endCount: recent.length,
      windowMs: RAPID_RESUME_WINDOW_MS,
      threshold: RAPID_RESUME_THRESHOLD,
    };
  }

  reset(chatroomId: string, role: string): void {
    this.history.delete(`${chatroomId}:${role.toLowerCase()}`);
  }
}
