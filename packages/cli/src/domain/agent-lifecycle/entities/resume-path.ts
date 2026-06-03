/**
 * How the daemon resumes agent work after a turn or process exit.
 *
 * Maps to existing RemoteAgentService hooks — names are stable for callers.
 */
export type ResumePath = 'in_process' | 'daemon_memory' | 'cold' | 'none';
