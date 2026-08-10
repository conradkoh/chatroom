/**
 * Read-model barrel. Member repositories (tasks, participants, agents) are
 * consumed directly by runtime callers (hydrate, shadow sync, restart
 * orchestrator); this barrel is the documented public API surface for the
 * read-model layer.
 */
// fallow-ignore-file unused-file
export {
  agentReadModelFromSnapshot,
  getAgentReadModel,
  upsertAgentReadModel,
  type AgentReadModelRow,
} from './agents.js';
export {
  getHandoffReadModel,
  upsertHandoffReadModel,
  type HandoffReadModelRow,
} from './handoffs.js';
export {
  participantReadModelFromSnapshot,
  getParticipantReadModel,
  upsertParticipantReadModel,
  type ParticipantReadModelRow,
} from './participants.js';
export { syncSnapshotsToReadModels, type ReadModelSyncCounts } from './snapshot-sync.js';
export { listSnapshotViewsFromReadModels } from './task-snapshot-adapter.js';
export {
  deleteTaskReadModel,
  listTaskReadModelsForChatroomRole,
  listTaskReadModelsForMachine,
  taskReadModelFromSnapshot,
  taskReadModelToSnapshot,
  upsertTaskReadModel,
  type TaskReadModelRow,
} from './tasks.js';
