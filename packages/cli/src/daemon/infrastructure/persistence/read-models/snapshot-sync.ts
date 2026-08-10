import type { DatabaseSync } from 'node:sqlite';

import { agentReadModelFromSnapshot, upsertAgentReadModel } from './agents.js';
import { participantReadModelFromSnapshot, upsertParticipantReadModel } from './participants.js';
import { taskReadModelFromSnapshot, upsertTaskReadModel } from './tasks.js';
import type { AssignedTaskSnapshotView } from '../../../domain/entities/assigned-task.js';

export type ReadModelSyncCounts = {
  taskCount: number;
  participantCount: number;
  agentCount: number;
};

/**
 * Synchronizes task, participant, and agent read models from assigned-task
 * snapshots. Shared by P2 startup hydration and the shadow-sync path so both
 * behave identically. Handoff rows are intentionally not created — no P2
 * snapshot/event contract carries handoff data.
 */
export function syncSnapshotsToReadModels(
  db: DatabaseSync,
  snapshots: AssignedTaskSnapshotView[]
): ReadModelSyncCounts {
  let participantCount = 0;
  for (const snapshot of snapshots) {
    upsertTaskReadModel(db, taskReadModelFromSnapshot(snapshot));
    if (snapshot.participant) {
      upsertParticipantReadModel(db, participantReadModelFromSnapshot(snapshot));
      participantCount++;
    }
    upsertAgentReadModel(db, agentReadModelFromSnapshot(snapshot));
  }
  return {
    taskCount: snapshots.length,
    participantCount,
    agentCount: snapshots.length,
  };
}
