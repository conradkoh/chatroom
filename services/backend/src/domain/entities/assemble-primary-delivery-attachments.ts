/**
 * Assembles typed primary-delivery attachment payloads for task delivery.
 *
 * Separated from convex/messages.ts so attachment assembly is unit-tested and
 * PRIMARY_DELIVERY_ATTACHMENT_KINDS exhaustiveness is enforced at compile time.
 *
 * @see ./message-attachments.ts — canonical attachment kind registry
 */
import type {
  DeliveryBacklogItem,
  DeliverySnippet,
  PrimaryDeliveryAttachmentKind,
  PrimaryDeliveryAttachments,
} from './message-attachments';

/** Resolved fields that may be assembled into primary delivery. */
export type PrimaryDeliveryAssemblyInput = PrimaryDeliveryAttachments;

type PrimaryDeliveryPicker = (
  input: PrimaryDeliveryAssemblyInput
) => DeliveryBacklogItem[] | DeliverySnippet[] | undefined;

/**
 * Per-kind field pickers — compiler errors when PRIMARY_DELIVERY_ATTACHMENT_KINDS
 * grows without adding a matching picker here.
 */
const PICK_PRIMARY_DELIVERY_FIELD = {
  backlog: (input) => (input.attachedBacklogItems?.length ? input.attachedBacklogItems : undefined),
  snippet: (input) => (input.attachedSnippets?.length ? input.attachedSnippets : undefined),
} satisfies Record<PrimaryDeliveryAttachmentKind, PrimaryDeliveryPicker>;

export interface SourceMessageForPrimaryDelivery {
  attachedSnippets?: DeliverySnippet[];
  attachedBacklogItemIds?: string[];
}

export interface ResolvedBacklogItemRecord {
  id: string;
  content: string;
  status: string;
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

/**
 * Resolve primary-delivery assembly input from a task source message and a
 * pre-fetched backlog item lookup.
 */
// fallow-ignore-next-line complexity
export function resolvePrimaryDeliveryAssemblyInput(
  message: SourceMessageForPrimaryDelivery | null | undefined,
  backlogItemsById: ReadonlyMap<string, ResolvedBacklogItemRecord>
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
  if (!attachedBacklogItems && !attachedSnippets) return undefined;

  const result: PrimaryDeliveryAttachments = {};
  if (attachedBacklogItems) result.attachedBacklogItems = attachedBacklogItems;
  if (attachedSnippets) result.attachedSnippets = attachedSnippets;
  return result;
}
