import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

const crons = cronJobs();

// Clean up old event stream records every hour to prevent unbounded growth
crons.interval('cleanup old events', { hours: 1 }, internal.eventCleanup.cleanupOldEvents);

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

export default crons;
