import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

const crons = cronJobs();

// Clean up old event stream records every 15 minutes to prevent unbounded growth
crons.interval('cleanup old events', { minutes: 15 }, internal.eventCleanup.cleanupOldEvents);

// Storage cleanup — command output (7-day TTL, hourly)
crons.interval('cleanup command output', { hours: 1 }, internal.storageCleanup.cleanupCommandOutput);

// Storage cleanup — command runs (30-day TTL, daily)
crons.interval('cleanup command runs', { hours: 24 }, internal.storageCleanup.cleanupCommandRuns);

// Storage cleanup — commit details (30-day TTL, daily)
crons.interval('cleanup commit details', { hours: 24 }, internal.storageCleanup.cleanupCommitDetails);

// Storage cleanup — cached content (24-hour TTL, hourly)
crons.interval('cleanup cached content', { hours: 1 }, internal.storageCleanup.cleanupCachedContent);

// Machine status — transition online→offline when heartbeat expires (every 60s)
crons.interval(
  'transition offline machines',
  { seconds: 60 },
  internal.machineStatusCron.transitionOfflineMachines
);

// Chatroom cleanup — workspace file tree (30-day stale, daily)
crons.interval('cleanup workspace file tree', { hours: 24 }, internal.chatroomCleanup.cleanupWorkspaceFileTree);

// Chatroom cleanup — orphaned read cursors (daily)
crons.interval('cleanup read cursors', { hours: 24 }, internal.chatroomCleanup.cleanupReadCursors);

// Chatroom cleanup — inactive machines 90d+ (daily)
crons.interval('cleanup machines', { hours: 24 }, internal.chatroomCleanup.cleanupMachines);

// Chatroom cleanup — orphaned participants (daily)
crons.interval('cleanup participants', { hours: 24 }, internal.chatroomCleanup.cleanupParticipants);

// Chatroom cleanup — inactive CLI sessions (daily)
crons.interval('cleanup cli sessions', { hours: 24 }, internal.chatroomCleanup.cleanupCliSessions);

// Chatroom cleanup — expired CLI auth requests 7d+ (daily)
crons.interval('cleanup cli auth requests', { hours: 24 }, internal.chatroomCleanup.cleanupCliAuthRequests);

// Chatroom cleanup — completed tasks 60d+ (daily)
crons.interval('cleanup completed tasks', { hours: 24 }, internal.chatroomCleanup.cleanupCompletedTasks);

// Capabilities refresh — fail batches stuck in pending (48h+, daily)
crons.interval(
  'expire stale capabilities refresh batches',
  { hours: 24 },
  internal.capabilitiesRefreshCron.expireStalePendingCapabilitiesRefreshBatches
);

export default crons;
