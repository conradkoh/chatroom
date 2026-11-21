'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type {
  BulkCreateOutcome,
  BulkCreateResult,
} from '@workspace/backend/src/domain/usecase/chatroom/create-chatrooms-for-working-dirs';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';

export function useBulkCreateChatrooms() {
  const createManyMutation = useSessionMutation(api.chatrooms.createManyWithWorkspace);

  /** One transaction per call. Rejects only on a whole-call failure; per-item failures are in `results`. */
  const createMany = useCallback(
    (machineId: string, workingDirs: string[]): Promise<BulkCreateResult> =>
      createManyMutation({ machineId, workingDirs }),
    [createManyMutation]
  );

  /** The single-row action: the same mutation with a one-element array. */
  const createOne = useCallback(
    async (machineId: string, workingDir: string): Promise<BulkCreateOutcome> => {
      const { results } = await createMany(machineId, [workingDir]);
      const [outcome] = results;
      if (!outcome) throw new Error('Create returned no outcome.');
      return outcome;
    },
    [createMany]
  );

  return { createMany, createOne };
}
