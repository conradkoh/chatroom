/**
 * Why an agent process stopped.
 *
 * Command-level reasons are set by the caller (doStop) and passed directly.
 * Process-level reasons are derived by resolveStopReason from exit info.
 */
import type { AgentStopReason } from '@workspace/backend/src/domain/entities/agent.js';

export type AgentProcessStopReason =
  'agent_process.exited_clean' | 'agent_process.signal' | 'agent_process.crashed';
export type StopReason = AgentStopReason | AgentProcessStopReason;

export function resolveStopReason(code: number | null, signal: string | null): StopReason {
  if (signal !== null) return 'agent_process.signal';
  if (code === 0) return 'agent_process.exited_clean';
  return 'agent_process.crashed';
}
