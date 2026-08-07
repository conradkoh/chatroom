/**
 * Core domain types for a Workspace — the long-lived pairing of a machine and
 * a working directory that anchors one or more harness sessions.
 */

/** Opaque identifier for a chatroom. */
export type ChatroomId = string & { readonly __brand: 'ChatroomId' };

/** Opaque identifier for a workspace, issued by the backend on registration. */
export type WorkspaceId = string & { readonly __brand: 'WorkspaceId' };

/**
 * A Workspace represents a specific machine + working-directory combination
 * associated with a chatroom. It is long-lived and can host multiple
 * HarnessSessions over its lifetime.
 */
export interface Workspace {
  readonly workspaceId: WorkspaceId;
  readonly chatroomId: ChatroomId;
  /** Identifier of the machine where the workspace resides. */
  readonly machineId: string;
  /** Absolute path to the working directory on the machine. */
  readonly cwd: string;
  /** Human-readable label for the workspace. */
  readonly name: string;
  readonly createdAt: number;
  readonly createdBy: string;
}
