import type { RefreshModelsOutcome } from './models-refresh.js';

// fallow-ignore-next-line unused-export
export const CAPABILITIES_REFRESH_STATUSES = ['completed', 'skipped_no_changes', 'failed'] as const;
export type CapabilitiesRefreshStatus = (typeof CAPABILITIES_REFRESH_STATUSES)[number];

export function capabilitiesOutcomeToStatus(outcome: RefreshModelsOutcome): {
  status: CapabilitiesRefreshStatus;
  errorMessage?: string;
} {
  switch (outcome.kind) {
    case 'pushed':
      return { status: 'completed' };
    case 'skipped_no_changes':
      return { status: 'skipped_no_changes' };
    case 'failed':
      return { status: 'failed', errorMessage: outcome.message };
    case 'noop':
      return { status: 'failed', errorMessage: 'Daemon configuration unavailable' };
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}
