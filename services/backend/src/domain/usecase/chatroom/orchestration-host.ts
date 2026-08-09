/**
 * P8 single-machine orchestration host — domain helpers.
 *
 * A chatroom's orchestration is bound to exactly one machine + one workspace
 * directory. All `chatroom_teamAgentConfigs` with `type: 'remote'` for the
 * chatroom must share the same `machineId` and `workingDir`.
 */

import type { Doc } from '../../../../convex/_generated/dataModel';

// fallow-ignore-next-line unused-export
export class OrchestrationHostConflict extends Error {
  readonly code = 'ORCHESTRATION_HOST_CONFLICT' as const;
  constructor(message: string) {
    super(message);
    this.name = 'OrchestrationHostConflict';
  }
}

export type OrchestrationHost = { machineId: string; workingDir: string };

type RemoteConfig = Pick<Doc<'chatroom_teamAgentConfigs'>, 'type' | 'machineId' | 'workingDir'>;

// fallow-ignore-next-line unused-export
export function listRemoteConfigs(configs: RemoteConfig[]): RemoteConfig[] {
  return configs.filter((c) => c.type === 'remote');
}

/** Resolve the single orchestration host for remote configs, or null when there is none / they conflict. */
// fallow-ignore-next-line complexity
export function resolveOrchestrationHost(configs: RemoteConfig[]): OrchestrationHost | null {
  const remote = listRemoteConfigs(configs);
  if (remote.length === 0) return null;
  const machineIds = new Set(remote.map((c) => c.machineId).filter(Boolean) as string[]);
  const workingDirs = new Set(remote.map((c) => c.workingDir).filter(Boolean) as string[]);
  if (machineIds.size !== 1 || workingDirs.size !== 1) return null;
  const machineId = machineIds.values().next().value as string | undefined;
  const workingDir = workingDirs.values().next().value as string | undefined;
  if (!machineId || !workingDir) return null;
  return { machineId, workingDir };
}

/** True when remote configs disagree on machine or workspace (or are ambiguous). */
export function hasOrchestrationHostConflict(configs: RemoteConfig[]): boolean {
  const remote = listRemoteConfigs(configs);
  if (remote.length === 0) return false;
  const machineIds = new Set(remote.map((c) => c.machineId).filter(Boolean));
  const workingDirs = new Set(remote.map((c) => c.workingDir).filter(Boolean));
  return machineIds.size > 1 || workingDirs.size > 1;
}

/** Throws OrchestrationHostConflict when remote configs disagree on machine or workspace. */
// fallow-ignore-next-line unused-export
export function assertSingleMachineWorkspace(configs: RemoteConfig[]): void {
  if (hasOrchestrationHostConflict(configs)) {
    throw new OrchestrationHostConflict(
      'All remote team agents must share the same machine and workspace directory'
    );
  }
}
