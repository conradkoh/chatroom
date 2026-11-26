/**
 * Message entity — canonical message-type vocabulary and read/wire shape.
 *
 * The `MESSAGE_TYPES` tuple is the single source of truth for every `type`
 * literal. The schema unions on `chatroom_messages` and
 * `chatroom_messageReadModels` derive their validators from it, and a
 * co-located drift test asserts the validator members stay in sync.
 *
 * Stored attachment *references* (`attachedTaskIds`, …) live on the database
 * rows. The wire carries resolved, flat arrays under the `attached*` names
 * (`attachedTasks`, …) because the webapp and CLI already read those names.
 *
 * @see docs/conventions/domain-models.md
 */

import { v } from 'convex/values';

import { toLiteralValidators } from './_shared/v-literals-of';
import type { AttachedFileView } from './file-attachment';

/** Source of truth for every `type` literal. Both schema unions derive from it. */
// The schema validator and the drift test consume this list; no other module imports it.
// fallow-ignore-next-line unused-export
export const MESSAGE_TYPES = [
  'message',
  'handoff',
  'join',
  'progress',
  'new-context',
  'notice',
  'plan',
  'grounding',
] as const;

export type MessageType = (typeof MESSAGE_TYPES)[number];

export const messageTypeValidator = v.union(...toLiteralValidators(MESSAGE_TYPES));

/** Rows hidden from the timeline and from pages. */
export const NON_TIMELINE_MESSAGE_TYPES = [
  'join',
  'progress',
] as const satisfies readonly MessageType[];

export function isTimelineMessageType(type: MessageType): boolean {
  return !(NON_TIMELINE_MESSAGE_TYPES as readonly string[]).includes(type);
}

export interface MessageSenderAgent {
  harness: string;
  model?: string | undefined;
}

export interface MessageTaskSnapshot {
  _id: string;
  status: string;
  content: string;
}

/**
 * Canonical read/wire shape for a chatroom message. Flat by design: per-type
 * fields are optional rather than a discriminated union.
 *
 * Per-type invariants:
 *
 * | type          | invariant |
 * | ------------- | --------- |
 * | `message`     | `senderRole` is `user` or an agent role. A row starts a page only when `senderRole` is exactly `user`. |
 * | `handoff`     | Carries `senderAgent` (harness/model snapshot) and `targetRole`. The stored `terminalHandoffKey` is not on the wire. |
 * | `notice`      | Agent → user interim note; no task transition. |
 * | `plan`        | Immutable; `supersedesPlanId` points at the plan it replaces. |
 * | `grounding`   | Immutable neutral observation record. |
 * | `new-context` | `contextCreatedBy` names the role that created the context. |
 * | `progress`    | Carries `taskId`; never part of the timeline or a page. |
 * | `join`        | Deprecated; never part of the timeline or a page. |
 */
export interface Message {
  _id: string;
  _creationTime: number;
  type: MessageType;
  senderRole: string;
  targetRole?: string | undefined;
  content: string;
  taskId?: string | undefined;
  taskOriginMessageId?: string | undefined;
  acknowledgedAt?: number | undefined;
  completedAt?: number | undefined;
  sourcePlatform?: string | undefined;
  scheduledPromptId?: string | undefined;
  // per-type
  /** Handoff only: harness + model of the sending agent at handoff time. */
  senderAgent?: MessageSenderAgent | undefined;
  /** Plan only: the plan this row supersedes. */
  supersedesPlanId?: string | undefined;
  /** New-context only: role that created the context. */
  contextCreatedBy?: string | undefined;
  /** `getContextForRole` (context-xml profile) only: the linked task snapshot. */
  task?: MessageTaskSnapshot | undefined;
  // resolved attachments (wire names; the webapp and CLI already read these)
  attachedTasks?: { _id: string; content: string; backlogStatus: string }[] | undefined;
  attachedBacklogItems?: { id: string; content: string; status: string }[] | undefined;
  attachedMessages?:
    { _id: string; content: string; senderRole: string; _creationTime: number }[] | undefined;
  attachedArtifacts?:
    | {
        _id: string;
        filename: string;
        description?: string | undefined;
        mimeType?: string | undefined;
      }[]
    | undefined;
  attachedFiles?: AttachedFileView[] | undefined;
  attachedSnippets?:
    { reference: string; fileSource: string; selectedContent: string }[] | undefined;
}
