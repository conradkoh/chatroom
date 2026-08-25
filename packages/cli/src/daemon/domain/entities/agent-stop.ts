// fallow-ignore-file unused-file unused-export unused-type
import type { AgentHarness } from './harness-shared-types.js';
import type {
  AgentStopScope,
} from '@workspace/shared/domain/agent-stop-command';
export type AgentStopReason = 'user.stop' | 'daemon.shutdown' | 'platform.dedup' | 'platform.team_switch' | 'platform.crash_recovery' | 'platform.resume_storm' | 'platform.task_start_in_new_session' | 'daemon.respawn' | 'user.restart';

export type AgentStopTermination = 'graceful' | 'forced' | 'absent';
export type AgentStopOutcome =
  | { kind: 'stopped'; pid: number; termination: Exclude<AgentStopTermination, 'absent'> }
  | { kind: 'already_stopped'; pid: number; termination: 'absent' };
export interface AgentStopTargetDescriptor {
  chatroomId: string;
  role: string;
  pid: number;
  agentHarness: AgentHarness;
  machineId: string;
  targetKey: string;
}
export class AgentStopError extends Error {
  readonly _tag = 'AgentStopError' as const;
  constructor(
    readonly code:
      'harness_missing' | 'harness_stop_failed' | 'still_alive' | 'lifecycle_delivery_failed' | 'stop_timed_out',
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'AgentStopError';
  }
}
export interface AgentStopScopeFilter {
  chatroomId: string;
  scope: AgentStopScope;
}
