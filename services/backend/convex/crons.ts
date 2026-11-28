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

// Machine deletion — restart dead purge chains (every 5 minutes)
crons.interval(
  'sweep machine deletions',
  { minutes: 5 },
  internal.machineDeletion.sweepMachineDeletions
);

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

// Repository ledger snapshots — remove expired requests and their chunks (every 5 minutes)
crons.interval(
  'cleanup expired repository ledger requests',
  { minutes: 5 },
  internal.repositoryLedger.cleanupExpiredLedgerRequests
);

// Remote folder browse sessions — delete idle-expired sessions and their listings (every 5 minutes)
crons.interval(
  'cleanup expired folder browse sessions',
  { minutes: 5 },
  internal.folderBrowse.cleanupExpiredFolderBrowseSessions
);

// Machine backup requests — expire stale rows and delete their ephemeral blobs (every minute)
crons.interval(
  'cleanup expired machine backup requests',
  { minutes: 1 },
  internal.machineBackups.cleanupExpiredBackupRequests
);

// Scheduled prompts — fire due prompts every minute
crons.interval('run scheduled prompts', { minutes: 1 }, internal.scheduledPrompts.runDue);

// Workspace uploads — expire stale storage-backed write requests
crons.interval(
  'expire stale workspace uploads',
  { minutes: 15 },
  internal.workspaceUploadCleanup.expireStaleWorkspaceUploadRequests
);

// File attachments — expire stale unbound uploads (pending and uploaded).
crons.interval(
  'expire stale file attachments',
  { minutes: 15 },
  internal.fileAttachments.expireStaleUploads,
  {}
);

// Workspace file-tree watches — release daemon coordinators after lease expiry.
crons.interval(
  'expire file tree watch leases',
  { minutes: 2 },
  internal.workspaceFileTreeWatchCron.expireFileTreeWatchLeases
);

export default crons;
