import { describe, expect, it } from 'vitest';

import { getAgentExitedRowDisplay } from './agentExitedRowDisplay';

describe('getAgentExitedRowDisplay', () => {
  it('maps task new-session stops to Exited/info/for new session', () => {
    expect(getAgentExitedRowDisplay({ stopReason: 'platform.task_start_in_new_session' })).toEqual({
      badgeText: 'Exited',
      badgeColor: 'info',
      secondaryInfo: 'for new session',
    });
  });

  it('maps crashes to Exited/error/crash', () => {
    expect(getAgentExitedRowDisplay({ stopReason: 'agent_process.crashed', exitCode: 1 })).toEqual({
      badgeText: 'Exited',
      badgeColor: 'error',
      secondaryInfo: 'exit(1) · crash',
    });
  });

  it('falls back for legacy events without stopReason', () => {
    expect(getAgentExitedRowDisplay({ intentional: false })).toEqual({
      badgeText: 'Exited',
      badgeColor: 'error',
      secondaryInfo: 'unknown',
    });
  });
});
