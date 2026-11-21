'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useCallback } from 'react';

import type { ReportFeedback } from '../utils/describeAgentOperation';

export interface DashboardSavedCommandDeleteOptions {
  /** The delete request. Passed in so tests substitute the port, not the module. */
  deleteSavedCommand: (args: { commandId: Id<'chatroom_savedCommands'> }) => Promise<unknown>;
  /** The dashboard strip's report. Clears first. */
  report: ReportFeedback;
}

/** Confirmed saved-command delete. Clears the strip, then reports an error notice if the request fails. */
export function useDashboardSavedCommandDelete({
  deleteSavedCommand,
  report,
}: DashboardSavedCommandDeleteOptions) {
  return useCallback(
    async (commandId: string) => {
      report(null);
      try {
        await deleteSavedCommand({ commandId: commandId as Id<'chatroom_savedCommands'> });
      } catch (error) {
        console.error('Failed to delete saved command:', error);
        report({ tone: 'error', message: 'Failed to delete command. Please try again.' });
      }
    },
    [deleteSavedCommand, report]
  );
}
