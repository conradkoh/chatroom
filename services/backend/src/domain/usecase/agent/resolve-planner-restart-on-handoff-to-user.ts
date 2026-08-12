import type { Doc } from '../../../../convex/_generated/dataModel';

export function resolvePlannerRestartOnHandoffToUser(
  config: Pick<Doc<'chatroom_teamAgentConfigs'>, 'plannerRestartOnHandoffToUser'> | null | undefined
): boolean {
  return config?.plannerRestartOnHandoffToUser !== false;
}
