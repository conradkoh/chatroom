import type { Doc } from '@workspace/backend/convex/_generated/dataModel';

/** A runnable command from the backend. */
export type RunnableCommand = Doc<'chatroom_runnableCommands'>;

/** Status of a command run. */
export type CommandRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'stopped' | 'killed';

/** A command run, representing a single execution of a command. */
export interface CommandRun {
  _id: string;
  commandName: string;
  script: string;
  status: CommandRunStatus;
  pid?: number;
  startedAt: number;
  completedAt?: number;
  exitCode?: number;
  terminationReason?: string;
}

/** A chunk of output from a running command. */
export interface OutputChunk {
  content: string;
  chunkIndex: number;
}
