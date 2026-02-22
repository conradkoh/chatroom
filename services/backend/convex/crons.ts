import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

const crons = cronJobs();

// Recover stuck tasks and clean up stale daemons every 2 minutes.
// Agent participant cleanup via FSM has been removed — liveness is tracked via lastSeenAt.
crons.interval('cleanup stale agents', { minutes: 2 }, internal.tasks.cleanupStaleAgents);

export default crons;
