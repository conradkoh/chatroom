import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

const crons = cronJobs();

// Clean up stale agents every 2 minutes
// This detects agents that exceeded their timeout (activeUntil/readyUntil)
// and removes them (agents re-join on reconnect), recovering any orphaned in_progress tasks
crons.interval('cleanup stale agents', { minutes: 2 }, internal.tasks.cleanupStaleAgents);

// Issue liveness challenges to all waiting agents every 3 minutes
// Agents must respond via resolveChallenge before the challenge expires (90s)
crons.interval('issue agent challenges', { minutes: 3 }, internal.participants.issueChallenge);

export default crons;
