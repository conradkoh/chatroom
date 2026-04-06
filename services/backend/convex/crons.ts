import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

const crons = cronJobs();

// Clean up old event stream records every hour to prevent unbounded growth
crons.interval('cleanup old events', { hours: 1 }, internal.eventCleanup.cleanupOldEvents);

export default crons;
