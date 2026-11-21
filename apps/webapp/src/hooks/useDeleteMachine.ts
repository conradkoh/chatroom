/**
 * Hook for owner-only, offline-only machine deletion.
 *
 * Thin wrapper over `machines.deleteMachine`; the server re-checks ownership and
 * connectivity, so callers only use row state to shape the confirmation UI.
 */

'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';

/** Owner-only, offline-only machine deletion (api.machines.deleteMachine). */
export function useDeleteMachine() {
  return useSessionMutation(api.machines.deleteMachine);
}
