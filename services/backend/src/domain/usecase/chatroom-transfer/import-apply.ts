/**
 * Chatroom import — apply-side types (pure module, types only in P6).
 *
 * The plan (`import-plan.ts`) hands the driver a flat list of chunks. A chunk is
 * the unit of one transactional apply: every row in a chunk references only
 * rows in strictly earlier chunks (or rows patched later through `links`), so a
 * chunk can be written without waiting for a later one.
 *
 * `refs` maps a **file key** to the id the target deployment assigned to that
 * row. The planner emits an empty map; the driver fills it after each apply, so
 * a later chunk can translate the file's keys into target ids.
 *
 * `links` chunks carry deferred cross-chunk references: the planner removes a
 * whole ref field from its row and patches it once its targets exist. Array
 * fields are deferred whole, never split.
 *
 * This file deliberately contains no runtime code: P7 adds the apply functions
 * here, and P6's specs import only the types.
 */

export type ImportTable =
  | 'workspaces'
  | 'artifacts'
  | 'backlog'
  | 'scheduledPrompts'
  | 'messages'
  | 'tasks'
  | 'contexts'
  | 'messageQueue'
  | 'links'
  | 'savedCommands'
  | 'skillCustomizations'
  | 'agentConfigs';

/** Room-level values the import writes onto the new chatroom. */
export interface ImportHeader {
  teamStructureId: string;
  name?: string;
  standingInstructions?: string;
  standingInstructionsEnabled?: boolean;
  standingInstructionsTitle?: string;
}

/** `key` is the file's `_key`. `fields` holds registry copy/ref/reset values; ref values are file keys. */
export interface ImportRowPayload {
  key: string;
  fields: Record<string, unknown>;
}

/** Tables whose rows the `links` phase may patch (B2: artifacts included for version links). */
export type LinkPatchTable = 'messages' | 'tasks' | 'artifacts';

/** One row's deferred ref fields, applied after the target rows exist. */
export interface LinkPatch {
  table: LinkPatchTable;
  key: string;
  fields: Record<string, string | string[]>;
}

export type ImportChunk =
  | {
      phase: 'workspaces';
      machineId: string;
      rows: ImportRowPayload[];
      primaryKey: string | null;
      refs: Record<string, string>;
    }
  | {
      phase: 'agentConfigs';
      machineId: string;
      rows: ImportRowPayload[];
      refs: Record<string, string>;
    }
  | {
      phase: Exclude<ImportTable, 'links' | 'workspaces' | 'agentConfigs'>;
      rows: ImportRowPayload[];
      refs: Record<string, string>;
    }
  | { phase: 'links'; patches: LinkPatch[]; refs: Record<string, string> };
