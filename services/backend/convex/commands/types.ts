export type CommandRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'killed';

/** Max commands per workspace sync to prevent abuse. */
export const MAX_COMMANDS_PER_SYNC = 500;

/** Max output chunk size (100KB). */
export const MAX_OUTPUT_CHUNK_BYTES = 100 * 1024;

/** Max output chunks per run (to bound storage). */
export const MAX_OUTPUT_CHUNKS_PER_RUN = 1000;
