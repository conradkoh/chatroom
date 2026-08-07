import type * as CursorSdkModule from '@cursor/sdk';

type SDKAgent = CursorSdkModule.SDKAgent;

export interface CursorSdkSessionCleanupState {
  agentClosed: boolean;
  preserveForResume: boolean;
  aborted: boolean;
}

/**
 * Close the Cursor SDK agent after an error or abort.
 * Graceful natural exit (code 0, not aborted) keeps the agent open for resumeFromDaemonMemory.
 */
// fallow-ignore-next-line complexity
export function closeCursorAgentOnFailure(
  agent: SDKAgent,
  session: CursorSdkSessionCleanupState,
  exitCode: number | null,
  force = false
): void {
  if (session.agentClosed || session.preserveForResume) return;
  if (!force && exitCode === 0 && !session.aborted) return;

  try {
    agent.close();
    session.agentClosed = true;
  } catch {
    // Best-effort cleanup
  }
}
