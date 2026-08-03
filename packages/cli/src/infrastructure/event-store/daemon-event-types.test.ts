import { describe, expect, test } from 'vitest';

import { DAEMON_EVENT_TYPES } from './daemon-event-types';

/**
 * Drift prevention: each constant must match the backend's event `type`
 * literal. If the backend renames a variant, this test fails loudly instead of
 * silently writing mismatched type strings into the local event store.
 */
describe('DAEMON_EVENT_TYPES', () => {
  const expected: Record<keyof typeof DAEMON_EVENT_TYPES, string> = {
    AGENT_EXITED: 'agent.exited',
    AGENT_STARTED: 'agent.started',
    AGENT_START_FAILED: 'agent.startFailed',
    AGENT_REGISTERED: 'agent.registered',
    AGENT_SESSION_RESUME_REQUESTED: 'agent.sessionResumeRequested',
    AGENT_SESSION_RESUMED: 'agent.sessionResumed',
    AGENT_SESSION_RESUME_FAILED: 'agent.sessionResumeFailed',
    AGENT_SESSION_REOPEN_RETRY: 'agent.sessionReopenRetry',
    AGENT_SESSION_AUGMENTED: 'agent.sessionAugmented',
    AGENT_HARNESS_SESSION_ID_UPDATED: 'agent.harnessSessionIdUpdated',
    AGENT_STOP_TIMEOUT: 'agent.stopTimeout',
    AGENT_RESTART_LIMIT_REACHED: 'agent.restartLimitReached',
    AGENT_RESTART_PHASE: 'agent.restartPhase',
    AGENT_RESTART_COMPLETED: 'agent.restartCompleted',
    AGENT_TASK_DELIVERED: 'agent.taskDelivered',
    AGENT_TASK_DELIVERY_FAILED: 'agent.taskDeliveryFailed',
  };

  for (const [key, value] of Object.entries(expected)) {
    test(`${key} matches '${value}'`, () => {
      expect(DAEMON_EVENT_TYPES[key as keyof typeof DAEMON_EVENT_TYPES]).toBe(value);
    });
  }
});
