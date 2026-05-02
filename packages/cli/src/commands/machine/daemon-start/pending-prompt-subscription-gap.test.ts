/**
 * Gap documentation test: daemon does NOT subscribe to chatroom_harnessSessions.
 *
 * This test suite documents the current architectural gap in the direct-harness
 * feature that causes the "New Session" button to be permanently disabled:
 *
 * - The webapp's `NewSessionButton` calls the backend `openSession` mutation,
 *   which inserts a `chatroom_harnessSessions` row in status='pending'.
 * - The daemon subscribes ONLY to `chatroom_pendingPrompts` via
 *   `startPendingPromptSubscription`. It does NOT watch `chatroom_harnessSessions`.
 * - Therefore, no daemon-side handler ever picks up the new session row and
 *   calls `getOrSpawn` to boot the harness.
 * - Without a harness boot, `publishMachineCapabilities` is never called with
 *   real agents, so `availableAgents.length` remains 0 and the button stays disabled.
 *
 * Fix (Phase B, pending user approval):
 *   Add a daemon subscription on `chatroom_harnessSessions` where status='pending'
 *   AND harnessSessionId=undefined, scoped to the machine's workspace IDs.
 *   The handler runs the existing `application/direct-harness/open-session.ts` flow:
 *   `getOrSpawn → spawner.openSession → associateHarnessSessionId`.
 *
 * When Phase B is implemented, the `.todo` tests below should be replaced with
 * passing assertions.
 */

import { describe, it } from 'vitest';

describe('daemon pending-session subscription gap (Phase A documentation)', () => {
  it.todo(
    "daemon should subscribe to chatroom_harnessSessions with status=pending AND harnessSessionId=undefined for the machine's workspaces"
  );

  it.todo(
    'when a new harnessSessions row appears (status=pending, harnessSessionId=undefined), daemon should call getOrSpawn for the workspace'
  );

  it.todo(
    'after getOrSpawn completes (harness boots), daemon should call spawner.openSession and then associateHarnessSessionId'
  );

  it.todo(
    'if harnessRegistry.getOrSpawn throws, session status should be set to failed and harnessSessionId remains undefined'
  );

  it.todo(
    "the subscription should be scoped to only the machine's own workspaces (no cross-machine processing)"
  );
});
