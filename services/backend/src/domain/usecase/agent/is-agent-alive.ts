/** An agent is "alive" if it has an active spawned process (non-null PID). */
export function isAgentAlive(spawnedAgentPid: number | undefined | null): boolean {
  return spawnedAgentPid != null;
}
