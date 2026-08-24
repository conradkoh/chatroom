import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

const crons = cronJobs();

// Storage cleanup — command output (7-day TTL, hourly)
crons.interval(
  'cleanup command output',
  { hours: 1 },
  internal.storageCleanup.cleanupCommandOutput
);

// Storage cleanup — command runs (30-day TTL, daily)
crons.interval('cleanup command runs', { hours: 24 }, internal.storageCleanup.cleanupCommandRuns);

// Storage cleanup — commit details (30-day TTL, daily)
crons.interval(
  'cleanup commit details',
  { hours: 24 },
  internal.storageCleanup.cleanupCommitDetails
);

// Storage cleanup — cached content (24-hour TTL, hourly)
crons.interval(
  'cleanup cached content',
  { hours: 1 },
  internal.storageCleanup.cleanupCachedContent
);

crons.interval(
  'recover expired machine command claims',
  { minutes: 1 },
  internal.machineCommandCleanup.recoverExpiredClaims
);
crons.interval(
  'cleanup expired machine commands',
  { minutes: 15 },
  internal.machineCommandCleanup.cleanupExpiredMachineCommands
);

// Machine status — transition online→offline when heartbeat expires (every 60s)
crons.interval(
  'transition offline machines',
  { seconds: 60 },
  internal.machineStatusCron.transitionOfflineMachines
);

// Chatroom cleanup — workspace file tree (30-day stale, daily)
crons.interval(
  'cleanup workspace file tree',
  { hours: 24 },
  internal.chatroomCleanup.cleanupWorkspaceFileTree
);

// Chatroom cleanup — orphaned read cursors (daily)
crons.interval('cleanup read cursors', { hours: 24 }, internal.chatroomCleanup.cleanupReadCursors);

// Chatroom cleanup — inactive machines 90d+ (daily)
crons.interval('cleanup machines', { hours: 24 }, internal.chatroomCleanup.cleanupMachines);

// Chatroom cleanup — orphaned participants (daily)
crons.interval('cleanup participants', { hours: 24 }, internal.chatroomCleanup.cleanupParticipants);

// Chatroom cleanup — inactive CLI sessions (daily)
crons.interval('cleanup cli sessions', { hours: 24 }, internal.chatroomCleanup.cleanupCliSessions);

// Chatroom cleanup — expired CLI auth requests 7d+ (daily)
crons.interval(
  'cleanup cli auth requests',
  { hours: 24 },
  internal.chatroomCleanup.cleanupCliAuthRequests
);

// Chatroom cleanup — completed tasks 60d+ (daily)
crons.interval(
  'cleanup completed tasks',
  { hours: 24 },
  internal.chatroomCleanup.cleanupCompletedTasks
);

// Capabilities refresh — fail batches stuck in pending (48h+, daily)
crons.interval(
  'expire stale capabilities refresh batches',
  { hours: 24 },
  internal.capabilitiesRefreshCron.expireStalePendingCapabilitiesRefreshBatches
);

// Direct harness cleanup — purge finalized turn chunks (1h TTL, hourly)
crons.interval(
  'purge finalized harness chunks',
  { hours: 1 },
  internal.directHarnessCleanup.purgeFinalizedChunks
);

// Agentic query cleanup — search history (7-day TTL, hourly)
crons.interval(
  'cleanup stale agentic queries',
  { hours: 1 },
  internal.agenticQueryCleanup.cleanupStaleAgenticQueries
);

// Connection close requests — purge expired rows (every 5 minutes)
crons.interval(
  'cleanup connection close requests',
  { minutes: 5 },
  internal.connectionCleanup.cleanupExpiredConnectionCloseRequests
);

// Enhancer jobs — purge terminal rows older than retention (daily)
crons.interval(
  'purge terminal enhancer jobs',
  { hours: 24 },
  internal.enhancerJobReaper.purgeTerminalEnhancerJobs
);

// Scheduled prompts — fire due prompts every minute
crons.interval('run scheduled prompts', { minutes: 1 }, internal.scheduledPrompts.runDue);

// Workspace uploads — expire stale storage-backed write requests
crons.interval(
  'expire stale workspace uploads',
  { minutes: 15 },
  internal.workspaceUploadCleanup.expireStaleWorkspaceUploadRequests
);

export default crons;
