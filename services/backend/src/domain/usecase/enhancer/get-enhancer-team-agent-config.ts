import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';
import { getLastSentLaunchRequestForRole } from '../agent/get-last-sent-launch-request';

/** Enhancer launch data resolved from an explicit request or legacy migration input. */
export type EnhancerAgentLaunchConfig = {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  type: 'remote';
  machineId: string;
  agentHarness: Doc<'chatroom_agentLastSentLaunchRequests'>['agentHarness'];
  model: string;
  workingDir?: string | undefined;
  enabled?: boolean | undefined;
};

/**
 * Reads the latest submitted enhancer launch request. The team ID is retained
 * in the signature for compatibility with callers during the migration; static
 * team structure is resolved by the request key, not a desired-config row.
 */
export async function getEnhancerTeamAgentConfig(
  ctx: QueryCtx | MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  _teamId: string
): Promise<EnhancerAgentLaunchConfig | null> {
  const request = await getLastSentLaunchRequestForRole(ctx, {
    chatroomId,
    role: 'enhancer',
  });
  if (!request || request.agentType !== 'remote') return null;
  return {
    chatroomId,
    role: request.role,
    type: 'remote',
    machineId: request.machineId,
    agentHarness: request.agentHarness,
    model: request.model,
    workingDir: request.workingDir,
    enabled: true,
  };
}

export function isCompleteRemoteEnhancerConfig(
  config: EnhancerAgentLaunchConfig | null | undefined
): boolean {
  return config?.enabled === true && hasRemoteEnhancerConfigFields(config);
}

export function hasRemoteEnhancerConfigFields(
  config: EnhancerAgentLaunchConfig | null | undefined
): boolean {
  return Boolean(
    config?.type === 'remote' &&
    config.machineId.trim() &&
    config.model.trim() &&
    config.agentHarness &&
    config.workingDir?.trim()
  );
}
