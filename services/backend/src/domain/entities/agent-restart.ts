import type { AgentHarness } from './agent';

// fallow-ignore-next-line unused-export
export const AGENT_RESTART_REASONS = [
  'user.restart',
  'platform.restart_offline_on_user_message',
] as const;

export type AgentRestartReason = (typeof AGENT_RESTART_REASONS)[number];

export interface RunnableRemoteAgentConfig {
  machineId: string;
  agentHarness: AgentHarness;
  model: string;
  workingDir: string;
  wantResume: boolean;
}

export type UserAgentRestartOverrides = Omit<RunnableRemoteAgentConfig, 'wantResume'>;

export type AgentRestartRequest =
  | {
      reason: Extract<AgentRestartReason, 'user.restart'>;
      overrides: UserAgentRestartOverrides;
    }
  | {
      reason: Extract<AgentRestartReason, 'platform.restart_offline_on_user_message'>;
    };

export type AgentRestartResult =
  | { status: 'requested'; correlationId: string; releasedTaskCount: number }
  | { status: 'skipped'; reason: string };

export function isRunnableRemoteTeamConfig(config: {
  type: string;
  machineId: string | undefined;
  agentHarness: AgentHarness | undefined;
  model: string | undefined;
  workingDir: string | undefined;
}): config is {
  type: 'remote';
  machineId: string;
  agentHarness: AgentHarness;
  model: string;
  workingDir: string;
} {
  return [
    config.type === 'remote',
    Boolean(config.machineId),
    Boolean(config.agentHarness),
    Boolean(config.model),
    Boolean(config.workingDir),
  ].every(Boolean);
}
