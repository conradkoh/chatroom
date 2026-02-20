import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

const crons = cronJobs();

// Clean up stale agents every 2 minutes
// This detects agents that exceeded their timeout (activeUntil/readyUntil)
// and removes them (agents re-join on reconnect), recovering any orphaned in_progress tasks
crons.interval('cleanup stale agents', { minutes: 2 }, internal.tasks.cleanupStaleAgents);

// Reconcile agent lifecycle records every 60 seconds
// Expires stale heartbeats (ready/working → dead) and cleans up stuck
// transitional states (dead/stopping/starting → offline)
crons.interval(
  'reconcile agent lifecycle',
  { seconds: 60 },
  internal.machineAgentLifecycle.reconcile
);

export default crons;
