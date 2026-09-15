import type { AgentProcessOperationResult } from './ports/agent-process-lifecycle.js';

export function assertStartSucceeded(result: AgentProcessOperationResult): void {
  if (!result.success) {
    throw new Error(`Agent start failed${result.error ? `: ${result.error}` : ''}`);
  }
}

export function assertStopSucceeded(result: { success: boolean }): void {
  if (!result.success) throw new Error('Agent stop failed');
}
