import type { AgentHarness } from '../types/machine';
import { harnessSupportsDaemonMemoryResume } from '../types/machine';

export function resolveDefaultWantResume(_teamId: string | undefined, _role: string): boolean {
  return false;
}

export function shouldShowResumeSessionToggle(
  teamId: string | undefined,
  role: string,
  agentHarness: AgentHarness | null
): boolean {
  if (teamId?.toLowerCase() === 'duo' && role.toLowerCase() === 'builder') return false;
  return agentHarness != null && harnessSupportsDaemonMemoryResume(agentHarness);
}
