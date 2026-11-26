---
type: decision-log
title: Message page model
description: One canonical flat message entity, one page entity derived from the existing table, one page API for webapp and CLI, and no data migration.
tags: [chatroom, messages, pages, cli]
status: active
---

# Message page model

## Context

`chatroom_messages` carries eight `type` literals but had four different read
shapes, two copies of the "timeline" predicate, and a page concept that existed
only in the webapp (`conversation.ts` called it an anchor/slice). The CLI read
history through five unrelated queries and never named the concept. This change
gives messages one canonical domain entity and makes the **page** a first-class
concept in one backend API, the webapp, the CLI, the prompts and the docs, with
**no data migration** (no row rewrite, backfill, field rename, table drop or
field drop).

The shipped behaviour, the per-type invariant table and the page invariants are
documented in
[`docs/features/message-domain-and-pages.md`](../../docs/features/message-domain-and-pages.md).

## Decisions

1. **One message entity file.** `services/backend/src/domain/entities/message.ts`
   holds `MESSAGE_TYPES`, `MessageType`, `messageTypeValidator`,
   `NON_TIMELINE_MESSAGE_TYPES`, `isTimelineMessageType` and the canonical
   `Message` read type. `MESSAGE_TYPES` is the single source of every `type`
   literal; both schema unions derive from it and a drift test asserts it. The
   file lives in the backend entities folder, not `packages/shared`, because
   `Message` needs `AttachedFileView` and `packages/shared` must stay a dependency
   leaf. The webapp imports the type only.
2. **Flat `Message`, not a discriminated union.** Stored rows are flat and stay
   flat, because there is no migration. Per-type invariants are enforced at the
   write funnels (`messages.sendMessage`, `messages.handoff`, `notifyUser`,
   `publish-plan`, `publish-grounding`). Only three readers branch on a per-type
   field. A union would force every fixture and consumer to narrow for no
   behavioural gain.
3. **Attachments: stored references, resolved wire arrays.** Rows keep
   `attachedTaskIds` and the other reference arrays plus inline
   `attachedSnippets`. The wire carries the resolved flat arrays the webapp and
   CLI already read (`attachedTasks`, `attachedBacklogItems`, `attachedMessages`,
   `attachedArtifacts`, `attachedFiles`, `attachedSnippets`).
   `DeliveryAttachmentsInput` stays the renderer input.
4. **Sender snapshot.** `Message.senderAgent?: { harness; model? }` replaces
   `SerializableSenderAgent` and the webapp `SenderAgentSnapshot`. It is handoff
   only, written once, informational. See
   [Handoff sender agent snapshot](/architecture/handoff-sender-agent.md).
5. **Task linkage.** `taskId`, `taskOriginMessageId`, `acknowledgedAt` and
   `completedAt` live on the message. `task?: { _id, status, content }` is
   populated only by `getContextForRole` for the `context-xml` profile.
6. **Delete the duplicate shapes.** `SerializableMessage`,
   `SerializableSenderAgent`, `EnrichedMessageInput` and `toSerializableMessage`
   are gone; `serializeMessage(message: Message, options)` takes the canonical
   type. The webapp `Message` is the domain `Message` plus queue-only UI fields,
   and the duplicated attachment interfaces are re-exported from the domain.
7. **Wire projection, not a whole-document spread.** `toMessage(doc,
resolvedAttachments)` picks exactly the `Message` fields. Internal columns
   (`claimedByRole`, `terminalHandoffKey`, `enhancerOriginalContent`, the
   deprecated fields) never reach a client. This makes the wire type exact and
   shrinks payloads.
8. **The domain name is "page".** Reject "slice" (internal `conversation.ts`
   jargon) and "turn" (collides with harness turns). A page is identified by its
   start message id; `startsPage` is `senderRole === 'user' && type ===
'message'` with exact lowercase comparison, matching the index prefix. The
   latest page is open (`endExclusive: null`). Convex pagination's result field
   `page` is a **fetch batch**, never a domain page.

## No-migration rationale

Removing or rewriting existing data is a destructive operation outside this
change, and Convex rejects a schema that no longer validates stored documents.
The seven deprecated `chatroom_messages` fields (`classification`,
`featureTitle`, `featureDescription`, `featureTechSpecs`, `enhancerJobId`,
`visibleInAllTabOnly`, `attachedWorkflowIds`), the
`chatroom_messageReadModels` / `chatroom_messageReadModelState` tables and the
read-model `taskStatus` therefore stay. Retiring them needs a separate,
explicitly approved migration.

Pages are derived from existing rows through the
`by_chatroom_senderRole_type_createdAt` index, so there is no page table, no
`pageId` column and no new index.

## Consequences

- One page API (`conversation.listPages`, `listPageMessages`,
  `subscribePageTail`) serves the webapp and the CLI. The CLI uses
  `messages pages | download | send` and shares its selector flags through
  `page-selection.ts`.
- Dead endpoints and the whole `messageList` module are removed, along with
  index `chatroom_messages.by_chatroom_senderRole_createdAt`.
- Prompts and docs use page vocabulary. `INVALID_PAGE` replaces
  `INVALID_ANCHOR`.
