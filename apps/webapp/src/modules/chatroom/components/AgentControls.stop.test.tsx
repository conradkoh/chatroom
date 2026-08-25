import { describe, expect, test } from 'vitest';

import { isActiveAgentStopState } from '../hooks/useAgentStop';

describe('AgentControls stop projection contract', () => {
  test('pending and stopping are busy while failed remains retryable', () => {
    expect(isActiveAgentStopState('pending')).toBe(true);
    expect(isActiveAgentStopState('stopping')).toBe(true);
    expect(isActiveAgentStopState('failed')).toBe(false);
  });
});
