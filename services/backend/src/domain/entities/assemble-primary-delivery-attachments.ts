/**
 * Assembles typed primary-delivery attachment payloads for task delivery.
 *
 * Separated from convex/messages.ts so attachment assembly is unit-tested and
 * PRIMARY_DELIVERY_ATTACHMENT_KINDS exhaustiveness is enforced at compile time.
 *
 * @see ./message-attachments.ts — canonical attachment kind registry
 */
import type {
  DeliveryAttachedMessage,
  DeliveryBacklogItem,
  DeliverySnippet,
  DeliveryTaskItem,
  PrimaryDeliveryAttachmentKind,
  PrimaryDeliveryAttachments,
} from './message-attachments';

/** Resolved fields that may be assembled into primary delivery. */
export type PrimaryDeliveryAssemblyInput = PrimaryDeliveryAttachments;

type PrimaryDeliveryPicker = (
  input: PrimaryDeliveryAssemblyInput
) =>
  | DeliveryBacklogItem[]
  | DeliverySnippet[]
  | DeliveryTaskItem[]
  | DeliveryAttachedMessage[]
  | undefined;

/**
 * Per-kind field pickers — compiler errors when PRIMARY_DELIVERY_ATTACHMENT_KINDS
 * grows without adding a matching picker here.
 */
const PICK_PRIMARY_DELIVERY_FIELD = {
  backlog: (input) => (input.attachedBacklogItems?.length ? input.attachedBacklogItems : undefined),
  snippet: (input) => (input.attachedSnippets?.length ? input.attachedSnippets : undefined),
  task: (input) => (input.attachedTasks?.length ? input.attachedTasks : undefined),
  message: (input) => (input.attachedMessages?.length ? input.attachedMessages : undefined),
} satisfies Record<PrimaryDeliveryAttachmentKind, PrimaryDeliveryPicker>;

export interface SourceMessageForPrimaryDelivery {
  attachedSnippets?: DeliverySnippet[];
  attachedBacklogItemIds?: string[];
  attachedTaskIds?: string[];
  attachedMessageIds?: string[];
}

export interface ResolvedBacklogItemRecord {
  id: string;
  content: string;
  status: string;
}

export interface ResolvedTaskRecord {
  id: string;
  content: string;
  status: string;
}

export interface ResolvedMessageRecord {
  id: string;
  content: string;
  senderRole: string;
}

function resolveBacklogItemsFromIds(
  ids: string[] | undefined,
  backlogItemsById: ReadonlyMap<string, ResolvedBacklogItemRecord>
): DeliveryBacklogItem[] | undefined {
  if (!ids?.length) return undefined;
  const items = ids.flatMap((id) => {
    const item = backlogItemsById.get(id);
    return item ? [{ _id: item.id, content: item.content, status: item.status }] : [];
  });
  return items.length > 0 ? items : undefined;
}

function resolveTasksFromIds(
  ids: string[] | undefined,
  tasksById: ReadonlyMap<string, ResolvedTaskRecord>
): DeliveryTaskItem[] | undefined {
  if (!ids?.length) return undefined;
  const items = ids.flatMap((id) => {
    const task = tasksById.get(id);
    return task ? [{ _id: task.id, content: task.content, status: task.status }] : [];
  });
  return items.length > 0 ? items : undefined;
}

function resolveMessagesFromIds(
  ids: string[] | undefined,
  messagesById: ReadonlyMap<string, ResolvedMessageRecord>
): DeliveryAttachedMessage[] | undefined {
  if (!ids?.length) return undefined;
  const items = ids.flatMap((id) => {
    const msg = messagesById.get(id);
    return msg ? [{ _id: msg.id, content: msg.content, senderRole: msg.senderRole }] : [];
  });
  return items.length > 0 ? items : undefined;
}

/**
 * Resolve primary-delivery assembly input from a task source message and
 * pre-fetched attachment lookups.
 */
// fallow-ignore-next-line complexity
export function resolvePrimaryDeliveryAssemblyInput(
  message: SourceMessageForPrimaryDelivery | null | undefined,
  backlogItemsById: ReadonlyMap<string, ResolvedBacklogItemRecord>,
  tasksById: ReadonlyMap<string, ResolvedTaskRecord>,
  messagesById: ReadonlyMap<string, ResolvedMessageRecord>
): PrimaryDeliveryAssemblyInput {
  const input: PrimaryDeliveryAssemblyInput = {};
  if (message?.attachedSnippets?.length) {
    input.attachedSnippets = message.attachedSnippets;
  }
  const attachedBacklogItems = resolveBacklogItemsFromIds(
    message?.attachedBacklogItemIds,
    backlogItemsById
  );
  if (attachedBacklogItems) {
    input.attachedBacklogItems = attachedBacklogItems;
  }
  const attachedTasks = resolveTasksFromIds(message?.attachedTaskIds, tasksById);
  if (attachedTasks) {
    input.attachedTasks = attachedTasks;
  }
  const attachedMessages = resolveMessagesFromIds(message?.attachedMessageIds, messagesById);
  if (attachedMessages) {
    input.attachedMessages = attachedMessages;
  }
  return input;
}

/**
 * Assemble the typed primary-delivery attachment payload passed to task renderers.
 * Returns undefined when every primary-delivery field is empty or absent.
 *
 * When adding a kind to PRIMARY_DELIVERY_ATTACHMENT_KINDS, update PICK_PRIMARY_DELIVERY_FIELD
 * (compile-time enforced) and add a matching field here (covered by contract tests).
 */
// fallow-ignore-next-line complexity
export function assemblePrimaryDeliveryAttachments(
  input: PrimaryDeliveryAssemblyInput
): PrimaryDeliveryAttachments | undefined {
  const attachedBacklogItems = PICK_PRIMARY_DELIVERY_FIELD.backlog(input);
  const attachedSnippets = PICK_PRIMARY_DELIVERY_FIELD.snippet(input);
  const attachedTasks = PICK_PRIMARY_DELIVERY_FIELD.task(input);
  const attachedMessages = PICK_PRIMARY_DELIVERY_FIELD.message(input);
  if (!attachedBacklogItems && !attachedSnippets && !attachedTasks && !attachedMessages) {
    return undefined;
  }

  const result: PrimaryDeliveryAttachments = {};
  if (attachedBacklogItems) result.attachedBacklogItems = attachedBacklogItems;
  if (attachedSnippets) result.attachedSnippets = attachedSnippets;
  if (attachedTasks) result.attachedTasks = attachedTasks;
  if (attachedMessages) result.attachedMessages = attachedMessages;
  return result;
}
