import type { AgentHarness } from '../types/machine';
import { harnessSupportsDaemonMemoryResume } from '../types/machine';

export function resolveDefaultWantResume(teamId: string | undefined, role: string): boolean {
  if (teamId?.toLowerCase() === 'duo' && role.toLowerCase() === 'builder') return false;
  return true;
}

export function shouldShowResumeSessionToggle(
  teamId: string | undefined,
  role: string,
  agentHarness: AgentHarness | null
): boolean {
  if (teamId?.toLowerCase() === 'duo' && role.toLowerCase() === 'builder') return false;
  return agentHarness != null && harnessSupportsDaemonMemoryResume(agentHarness);
}
