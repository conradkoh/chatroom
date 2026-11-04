/**
 * The Custom Agents tab's single state decision.
 *
 * Pure and total: a missing roster wins over team and workspace complaints, so
 * the first paint never flashes a state the data has not proved yet.
 */

import { supportsCustomAgents } from '@workspace/shared/domain/custom-agent';

import type { TeamRosterResult } from './customAgentsViewModel';

export type CustomAgentsGate = 'loading' | 'unsupported' | 'no-workspace' | 'empty' | 'loaded';

/**
 * Picks the one state to render. Order is deliberate: a missing roster wins over
 * team/workspace complaints, so the first paint never flashes a wrong gate.
 */
export function resolveCustomAgentsGate(input: {
  isLoading: boolean;
  roster: TeamRosterResult | undefined;
  teamId: string | undefined;
  hasWorkspace: boolean;
  rowCount: number;
}): CustomAgentsGate {
  if (isPendingInput(input.isLoading, input.roster)) return 'loading';
  if (!teamSupportsCustomAgents(input.teamId)) return 'unsupported';
  if (!input.hasWorkspace) return 'no-workspace';
  return emptyOrLoaded(input.rowCount);
}

function isPendingInput(isLoading: boolean, roster: TeamRosterResult | undefined): boolean {
  return isLoading || roster === undefined;
}

function teamSupportsCustomAgents(teamId: string | undefined): boolean {
  return supportsCustomAgents(teamId ?? '');
}

function emptyOrLoaded(rowCount: number): CustomAgentsGate {
  return rowCount === 0 ? 'empty' : 'loaded';
}
