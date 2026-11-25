---
type: decision-log
title: Grounding messages
description: Neutral, immutable grounding documents published by entry points as type grounding chat messages, validated by one skeleton validator, read back by id, and referenced from handoff templates as a starting point to verify against the code.
tags: [chatroom, grounding, messages, handoff, cli, prompts]
status: active
---

# Grounding messages

## Context

Before delegating discovery work, an entry point explores the repository to find
the relevant files, entry points and flow. The recipient used to repeat that
exploration from scratch. A grounding document records those observations once,
as facts, so the recipient starts from them instead of rediscovering them. It
is referenced from the handoff templates the sender uses, and recipients are
told to treat it as a starting point, not as verified truth. The trio flow that
carries it is described in
[Trio team coordination](/architecture/trio-team-coordination.md).

## Decisions

1. **A grounding is a `type: 'grounding'` message.** The message kind is added to both literal unions (`chatroom_messages.type` and the read-model `type`). A grounding is a row in the existing message table, not a new table or attachment, so it sits in the timeline order and flows through existing read paths. The row is `{ chatroomId, senderRole, content, type: 'grounding' }`: no `taskId`, no `targetRole`, no attachments and no new field. Publishing does not patch `lastActivityAt`, mark the chatroom unread, or create tasks.
2. **Dedicated publish use case and Convex surface, mirroring plans.** `publishGrounding` in `src/domain/usecase/message/publish-grounding.ts` reuses `assertValidSenderRole`, `senderHasActiveTask` and `insertChatroomMessage`. `convex/groundings.ts` exposes `publish` and `get`. There is no generic typed-document layer: two document types do not pay back the abstraction, and their validators, ids and CLI differ.
3. **Immutable; republish with no `--supersedes`.** There is no update or delete path. A grounding has no internal references and no consumer of a revision link, so it needs no successor field and no successor scan. The sender cites the newest id in each handoff. Publishing is not idempotent: a retry after a lost response creates a second row, and the printed id is the one the author cites.
4. **A validator, not a parser.** `validateGrounding` is a pure function in `src/domain/grounding/validate-grounding.ts`. Nothing extracts structure from a grounding; a reader consumes it as markdown. The CLI pre-checks with the validator, the backend re-checks authoritatively on publish. Neutrality ("no conclusions") cannot be machine-checked: it is enforced by the template text and the publish guidance, and stated as a prompt rule.
5. **Template: six sections, all facts.** Request, Relevant files, Entry points, Flow, Prior records and Not inspected, in that fixed order. `Request` and `Relevant files` must have content; the other four may be exactly `None observed.` (or `- None observed.`). There is no Recommendations, Risks or Design section: a risk is a conclusion.
6. **Template text is generated from the spec.** `src/domain/grounding/grounding-template-spec.ts` holds the section names, order, length limit, none token and validator error codes. The CLI skeleton and the rules block are built from those constants, so the printed shape cannot drift from what the validator accepts.
7. **Reference in handoff templates: appended once by the resolver.** `renderHandoffTemplate` appends one block from `prompts/cli/grounding/reference.ts` when the pair carries it. The predicate is: the team's `entryPoint` is `fromRole` and `toRole` is not `user`, or the pair is `trio:specifier→builder`. Report templates back to the delegator, templates to `user`, and `specifier→coordinator` do not carry it, because the delegator already holds the id. The block sits outside the template's fenced brief and tells the sender to paste a fixed `## Grounding` section into its message.
8. **Publish guidance is one shared function on the three entry-point prompts.** `getGroundingPublishGuidance` is called from the trio coordinator, duo planner and solo guidance. It defines the concept and prints the real publish command. Publishing is guidance only: the backend does not require a grounding id on a handoff.

## Command surface

- `chatroom grounding view-template`: static, prints the fill-in skeleton and the rules. No chatroom or role needed.
- `chatroom grounding publish --chatroom-id --role`: reads the markdown from a `CHATROOM_GROUNDING_END` heredoc, validates it, stores it, and prints the grounding id.
- `chatroom grounding read --chatroom-id --role --grounding-id`: prints the stored content. `--role` is accepted and not used by the read.

There is no `--supersedes` and no update or delete command.

## Template

Six required sections in fixed order: Request, Relevant files, Entry points, Flow, Prior records, Not inspected. The H1 title is required; the `Grounding: ` prefix is guidance in the skeleton, not enforced. Headings inside fenced code blocks are ignored, so the sequence diagram is content. `Request` and `Relevant files` must have content. Entry points, Flow, Prior records and Not inspected may be `None observed.` (or the bullet form); content that only repeats the none token in a content-required section is rejected. The limit is 20 000 characters. The skeleton and the rules block both come from `grounding-template-spec.ts`.

## Error codes

- `INVALID_GROUNDING`: the content does not match the template. The error carries every validator violation as `{ code, line, message }`.
- `GROUNDING_TOO_LONG`: content over 20 000 characters. Reported alone on line 1.
- `GROUNDING_TITLE_MISSING`: the first non-blank line is not an H1.
- `GROUNDING_SECTION_MISSING`: a required `##` section is absent.
- `GROUNDING_SECTION_ORDER`: a section is unknown, duplicated or out of order.
- `GROUNDING_SECTION_EMPTY`: a section has no body, or a content-required section holds only the none token.
- `GROUNDING_FENCE_UNCLOSED`: a code fence opened and never closed.
- `GROUNDING_NOT_FOUND`: `get` was given a malformed id, another message type, or an id in another chatroom.
- `INVALID_ROLE`: the sender is `user` or is not in the chatroom's team configuration.
- `EMPTY_CONTENT`: the content is blank.
- `NO_ACTIVE_TASK`: the sender has no `in_progress`, `acknowledged` or `pending` task.

A rejected publish stores no row.

## Reference block

The resolver appends one `### Grounding reference` block after the handoff body when the pair carries it. The carrier predicate is `getTeamPreset(teamId)?.entryPoint === fromRole && toRole !== 'user'`, or `trio:specifier→builder`. The block contains a fenced `## Grounding` section with the grounding id line and the `chatroom grounding read` command for the recipient, plus the instruction to treat the document as a starting point and prefer the code where they differ. It is appended once in `renderHandoffTemplate`; getter files are not edited.

## Rollback caution

Never remove the `grounding` literal from the schema once any row exists. A schema deployment with rows of a dropped literal fails validation. There is no purge migration for this literal, and a dropped message type can only be cleared from a deployment's data store.
