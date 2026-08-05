/** Legacy: packages/cli/src/commands/machine/daemon-start/handlers/process/spawner.ts */
export type ProcessSpawnPort = {
  spawn(command: string, args: string[]): Promise<{ pid: number }>;
};
