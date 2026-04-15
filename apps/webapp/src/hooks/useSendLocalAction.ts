/**
 * Hook for sending local actions to a machine's daemon via Convex.
 *
 * Replaces the direct `fetch('http://localhost:19847/api/...')` calls
 * to work around Safari's mixed-content blocking of http://localhost
 * from HTTPS production pages.
 *
 * The action is sent as a Convex mutation that inserts a `daemon.localAction`
 * event into the event stream. The daemon picks it up via its command loop
 * subscription and executes it locally.
 */

'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';

import type { LocalActionType } from '@workspace/backend/config/localActions';
export type { LocalActionType };

// Extended type that includes additional git actions
// The actual type in Convex will be updated when the backend is deployed
export type ExtendedLocalActionType =
  | LocalActionType
  | 'git-discard-file'
  | 'git-discard-all'
  | 'git-pull';

/**
 * Returns a callback to send a local action to a machine's daemon via Convex.
 *
 * @example
 * ```tsx
 * const sendAction = useSendLocalAction();
 * <button onClick={() => sendAction('m-abc-123', 'open-vscode', '/path/to/repo')}>
 *   Open in VS Code
 * </button>
 * ```
 */
export function useSendLocalAction() {
  const mutation = useSessionMutation(api.machines.sendLocalAction);

  return useCallback(
    async (machineId: string, action: LocalActionType, workingDir: string) => {
      try {
        await mutation({ machineId, action, workingDir });
      } catch (err) {
        console.warn(`[sendLocalAction] ${action} failed:`, err);
      }
    },
    [mutation]
  );
}
