import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

const crons = cronJobs();

// Clean up stale daemons every 2 minutes.
// Agent participant cleanup and acknowledged-task recovery have been removed —
// agents are expected to call task-started then handoff normally.
crons.interval('cleanup stale machines', { minutes: 2 }, internal.tasks.cleanupStaleMachines);

export default crons;
