# Feature: Message domain and pages

**Status:** Implemented
**Last Updated:** 2026-11-26

---

## Overview

Chatroom history has one canonical message shape and one first-class grouping: the
**page**. This document defines both, plus the wire projection, the attachment
model, and which parts of the legacy shape are retained only so existing
documents still validate.

The canonical code lives in:

- `services/backend/src/domain/entities/message.ts` — message vocabulary and the wire `Message`.
- `services/backend/src/domain/entities/conversation-page.ts` — page predicate, constants and `PageRef`.
- `services/backend/convex/conversation.ts` — the page API.
- `packages/cli/src/commands/messages/` — the page-based CLI (see
  [messages-cli-reference.md](./messages-cli-reference.md)).

## 1. Message types

`MESSAGE_TYPES` in `services/backend/src/domain/entities/message.ts` is the only
authored list of `type` literals. Both schema unions (`chatroom_messages.type` and
`chatroom_messageReadModels.type`) derive their Convex validators from it, and a
co-located drift test asserts the validator members match the tuple.

```ts
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
```

`isTimelineMessageType(type)` is true for every type except the two in
`NON_TIMELINE_MESSAGE_TYPES` (`join`, `progress`). The **timeline** is therefore
all rows except `join` and `progress`.

### Per-type invariants

These are the invariants the write funnels produce. The funnel spec asserts them;
they are not a discriminated union.

| type          | sender                  | timeline | page start                                   | per-type fields                                                                                                                                              | notes                                                                                                                                      |
| ------------- | ----------------------- | -------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `message`     | `user` or an agent role | yes      | **only when `senderRole` is exactly `user`** | `sourcePlatform?`, `scheduledPromptId?`                                                                                                                      | User messages get a task when routed to an agent; queued user messages live in `chatroom_messageQueue` and become a row only on promotion. |
| `handoff`     | agent role              | yes      | no                                           | `targetRole`, `senderAgent?` (written once, handoff only), `terminalHandoffKey?` (handoff-to-user only), `taskOriginMessageId?`, `completedAt?`, attachments |                                                                                                                                            |
| `notice`      | agent role              | yes      | no                                           | none                                                                                                                                                         | No task transition.                                                                                                                        |
| `plan`        | agent role              | yes      | no                                           | `supersedesPlanId?`                                                                                                                                          | Immutable. See [Plan messages](/architecture/plan-messages.md).                                                                            |
| `grounding`   | agent role              | yes      | no                                           | none                                                                                                                                                         | Immutable. See [Grounding messages](/architecture/grounding-messages.md).                                                                  |
| `new-context` | system / role           | yes      | no                                           | `contextCreatedBy`                                                                                                                                           |                                                                                                                                            |
| `progress`    | agent role              | **no**   | no                                           | `taskId`                                                                                                                                                     | Excluded from the timeline and from pages.                                                                                                 |
| `join`        | n/a                     | **no**   | no                                           | none                                                                                                                                                         | Deprecated; no longer created.                                                                                                             |

## 2. Flat `Message`

`Message` is a flat interface with a closed `type: MessageType`, not a
discriminated union:

- The database rows are flat and must stay flat, because there is no data
  migration and stored rows keep their shape.
- Per-type invariants are enforced where a row is written: `messages.sendMessage`,
  `messages.handoff`, `notifyUser`, `publish-plan` and `publish-grounding`.
- No reader narrows on a per-type field except three `type ===` checks (the
  serializer's plan/grounding tag, the timeline mapper, and new-context
  rendering). A union would force every fixture and consumer to narrow for no
  behavioural gain.

The per-type fields are optional on the flat type and carry a TSDoc invariant
table, repeated above.

## 3. Attachments

Stored rows keep **reference arrays**:

- `attachedTaskIds`
- `attachedBacklogItemIds`
- `attachedMessageIds`
- `attachedArtifactIds`
- `attachedFileIds`
- inline `attachedSnippets`

The wire carries **resolved, flat arrays** under the names the webapp and CLI
already read:

- `attachedTasks`
- `attachedBacklogItems`
- `attachedMessages`
- `attachedArtifacts`
- `attachedFiles`
- `attachedSnippets`

`DeliveryAttachmentsInput` remains the renderer input. `serialize-message.ts`
normalizes the flat wire arrays into it (accepting the older delivery names
`{ status }` / `{ _id }` as well).

## 4. Wire projection

`toMessage(doc, resolvedAttachments): Message` picks exactly the `Message`
fields. A raw `chatroom_messages` document is never spread onto the wire, so
internal columns (`claimedByRole`, `terminalHandoffKey`, `enhancerOriginalContent`,
the deprecated fields below) never reach a client. This makes the wire type exact
and shrinks every message payload.

## 5. Sender snapshot

`senderAgent?: { harness: string; model?: string }` is written on **handoff rows
only**, once, at handoff time. It is informational: nothing routes, filters,
sorts, or resumes on it, and it is never refreshed after the write. Rows without
a snapshot render no chip. The full rules are in
[Handoff sender agent snapshot](/architecture/handoff-sender-agent.md).

## 6. Task linkage

Task linkage lives on the message row:

- `taskId?` — the task created for this message (user messages).
- `taskOriginMessageId?` — the original user message that started the task chain.
- `acknowledgedAt?` — when an agent started work.
- `completedAt?` — when work completed (via handoff).

`task?: { _id, status, content }` is populated **only** by
`getContextForRole` for the `context-xml` profile. It is not part of the page
wire payload.

## 7. Page

A **page** is one user message plus every timeline message from that message up to
the next user message (exclusive). A page is the unit of history navigation in the
webapp and the CLI.

### Page invariants

1. A page is identified by its **start message id** (`pageId` = `_id` of a
   `chatroom_messages` row). No page table or page id column exists.
2. A start message satisfies `startsPage(m)`: `m.senderRole === 'user' &&
m.type === 'message'`. The comparison is **exact lowercase `'user'`**, matching
   the equality prefix of index `by_chatroom_senderRole_type_createdAt`, so the
   predicate and the index cannot disagree.
3. A page covers `_creationTime ∈ [startedAt, endExclusive)` in `by_chatroom`
   order. `endExclusive` is the `_creationTime` of the next start message in the
   same chatroom, or `null` for the **latest page, which is open**.
4. Page content = rows in the range where `isTimelineMessageType(type)` is true.
   `join` and `progress` are never page content.
5. Pages partition the conversation after the first user message: contiguous,
   non-overlapping, ordered by `_creationTime`. Rows before the first start
   message belong to no page (documented; unreachable through the page API).
6. Navigation: `prevPageId` is the start message immediately before this page's
   start; `nextPageId` is the one immediately after.
7. Queued user messages are not page starts until promoted (the row is inserted
   at promotion). This is the existing "chat history in task processing order"
   rule.
8. The design relies on `_creationTime` being unique per chatroom (the existing
   assumption in `conversation.ts`).

### Start-message identity and `endExclusive`

Because a page id is the start message's `_id`, a page survives edits to its
content: the id never moves. `endExclusive` is a `_creationTime` bound, not an id,
so it is stable for a closed page and `null` only for the open latest page. A
fresh user message closes the previous latest page by supplying its
`_creationTime` as the new `endExclusive`.

### Open latest page

The latest page is open: its `endExclusive` is `null` because no later start
message exists yet. Readers that download it guard against a new start arriving
mid-read by stopping at the first message where `startsPage(m)` is true and
`m._id !== pageId` (the CLI download does this). The webapp re-resolves the page
window reactively, so the selected page flips to the new latest page.

## 8. Fetch batch vs page

Convex pagination returns a result field named `page` (`PaginationResult.page`).
That field is a **fetch batch**, not a domain page. Documentation and code
comments say "fetch batch" for it, and code constants use `FETCH_BATCH_SIZE`
(50) rather than `PAGE_SIZE`. Never call a fetch batch a page.

## 9. API map

Page API, in `services/backend/convex/conversation.ts`:

- `conversation.listPages({ sessionId, chatroomId, pageId?, before?, after? })`
  → `PageWindow` (`pages`, `selectedPageId`, `prevPageId`, `nextPageId`).
- `conversation.listPageMessages({ sessionId, chatroomId, pageId, endExclusive?, paginationOpts })`
  → `{ page: Message[], isDone, continueCursor }` (a fetch batch plus its status).
- `conversation.subscribePageTail({ sessionId, chatroomId, afterCreationTime, endExclusive })`
  → `Message[] | null` (≤100 rows).

Surviving message endpoints in `services/backend/convex/messages.ts`:

- `messages.sendMessage`
- `messages.handoff`
- `messages.notifyUser`
- `messages.listQueued`
- `messages.enqueueMessageAtFront`
- `messages.updateQueuedMessageEnvelope`
- `messages.updateQueuedMessageConversationMode`
- `messages.deleteUserMessageOrTask`
- `messages.updateUserMessageOrTask`
- `messages.claimMessage`
- `messages.getInitPrompt`
- `messages.getTaskDeliveryPrompt`
- `messages.getContextForRole`

## 10. Removed in this change

The following were removed because they are superseded by the page API or had no
production caller:

- Endpoints: `messages.send`, `messages.list`, `messages.getProgressForTask`,
  `messages.getLatestForRole`, `messages.getRolePrompt`,
  `messages.updateQueuedMessageStartInNewSession`, `messages.listBySenderRole`,
  `messages.getLastUserMessage`, `messages.listSinceMessage`.
- The whole `messageList` module: `getLatestMessages`, `subscribeNewMessages`,
  `listMessagesBefore`.
- Conversation endpoints: `conversation.getConversationAnchorNavigation`,
  `conversation.listConversationSlicePaginated`,
  `conversation.subscribeConversationSliceTail`.
- Index `chatroom_messages.by_chatroom_senderRole_createdAt`.
- The `INVALID_ANCHOR` error code, replaced by `INVALID_PAGE`.

The CLI replacements are listed in
[messages-cli-reference.md](./messages-cli-reference.md#5-old--new-command-map).

## 11. Retained for existing data (no migration)

This change does **not** migrate or delete existing rows. The following are kept
so stored documents still validate and existing data stays readable:

- The seven deprecated `chatroom_messages` fields: `classification`,
  `featureTitle`, `featureDescription`, `featureTechSpecs`, `enhancerJobId`,
  `visibleInAllTabOnly`, `attachedWorkflowIds`.
- The `chatroom_messageReadModels` and `chatroom_messageReadModelState` tables.
- The read-model `taskStatus` denormalized field.

Reason: Convex rejects a schema that no longer validates existing documents, and
deleting rows is a destructive operation outside this change. Retiring any of
them needs a separate, explicitly approved migration.
