---
type: decision-log
title: Plan messages
description: Phased plans are immutable type plan chat messages in canonical markdown, validated by one parser, referenced as planId#Pn, revised with supersedes; distinct from the docs/plans file convention.
tags: [chatroom, plans, messages, trio, architect, product-manager, coordinator, cli]
status: active
---

# Plan messages

## Context

The trio specifier used to write its full ordered slice plan into each slice report, and the coordinator copied the remaining slice plan into every following work package. A fresh session has no memory of the earlier report, so the plan drifted, got reconstructed from prose, or was lost between slices. A plan is now a first-class chat artifact that the architect (default) or product-manager publishes when the coordinator asks; every role can read it by id; the coordinator cites `<planId>#Pn` phases in each work package. The trio flow that uses it is described in [Trio team coordination](/architecture/trio-team-coordination.md), decisions 8–10.

## Decisions

1. **A plan is a `type: 'plan'` message.** The message kind is defined in the shared `MESSAGE_TYPES` tuple (`services/backend/src/domain/entities/message.ts`). A plan is a row in the existing message table, not a new table or an attachment, so it sits in the timeline order, flows through the existing read paths, and appears in `messages download` with no new query. The row carries no `taskId`, no `targetRole`, and no attachments. Publishing does not patch `lastActivityAt` and does not mark the chatroom unread.
2. **Canonical markdown in `content`, one parser.** The stored `content` is the plan markdown and is the only source of truth; no structured phase columns are duplicated. `parsePlan` (pure, in `services/backend/src/domain/plan/`) is the single validator. The CLI pre-checks with it, the backend re-checks authoritatively on publish, and the webapp and `plan read --phase` re-parse the stored markdown. The template skeleton that `chatroom plan view-template` prints is built from the same constants the parser enforces, so the documented shape cannot drift from the accepted one.
3. **Ids: plan id is the message id; phases are `Pn`.** The plan id is the `chatroom_messages` `_id`, the same id that `messages download` and `messages download --page-id` use. Phase ids `P1…Pn` are authored in the markdown and validated sequential and unique. The unambiguous reference is the pair, written in prose as `<planId>#Pn`. A bare `P2` is never a reference, because a phase id is only meaningful inside its plan.
4. **Immutable; revision is a new plan with `--supersedes`.** No update or delete path exists for plans. A revision is published as a new plan with `--supersedes <oldPlanId>`, stored as `supersedesPlanId` and validated to be a plan in the same chatroom (`INVALID_SUPERSEDES` otherwise). The revised plan restarts at `P1`. Because every reference is `<planId>#Pn`, a phase already delegated from the old plan stays unambiguous. The revised plan's `## Remarks` states, for each delegated phase, whether it is unchanged, replaced by a new phase, or dropped. That rule is a prompt rule, not a machine check. The coordinator decides which plan id to cite next; the backend does not.
5. **Successor lookup is same-sender only, by design.** `plan read` reports `supersededBy` as a best-effort, advisory link. The lookup scans later plans with the same `chatroomId`, `senderRole`, and `type` through the existing `by_chatroom_senderRole_type_createdAt` index, takes at most 50, and matches `supersedesPlanId`. A revision published by a different sender role is therefore not reported as superseding the earlier plan. This is accepted because each task has one plan author — the architect by default, or the product-manager — and a revision is requested from the same role, so the same-sender lookup holds and no new index is needed. Do not treat `supersededBy` as authoritative; the coordinator confirms the revision through the plan author's report.
6. **Plans are not `docs/plans/` files.** The repository's `docs/plans/` folder (`pending/`, `active/`, `complete/`) holds human-written, per-PR delivery plans as files. A plan message is a runtime chatroom object created by an agent. The two share a word and nothing else: there is no code or storage relationship. Keep the names apart: the CLI group is `plan`, the timeline label is `plan`, and the repository folder keeps its own name. Do not add `docs/plans/` tooling to the plan message path.

## Command surface

- `chatroom plan view-template`: static, prints the fill-in template. No chatroom or role needed.
- `chatroom plan publish --chatroom-id --role [--supersedes <planId>]`: reads the markdown from a `CHATROOM_PLAN_END` heredoc, validates it, and prints the plan id and phase ids.
- `chatroom plan read --chatroom-id --role --plan-id [--phase Pn]`: prints the stored markdown, or one phase projection. `PLAN_NOT_FOUND` (printed as `Plan not found: <id>`) for a malformed, foreign, or non-plan id; `Phase not found: Pn` lists the available phase ids.

Publishing is not idempotent: a retried publish after a lost response creates a second plan, and the printed id is the one the author cites.

## Template and validation

- Required sections: title (H1), Sources, Requirements, Constraints, Phases, and Phase details. Every phase needs Requirements, Constraints, and Acceptance criteria. Depends on and Remarks are optional. `None.` is allowed only for Sources, Constraints, Depends on, and a phase's Constraints.
- Headings inside fenced code blocks are ignored, so phase bodies may contain code. A code fence must be closed by a bare run of the same character at least as long as its opener (a 4-backtick fence can contain ``` lines); an unclosed fence is rejected at the opening line (`PLAN_FENCE_UNCLOSED`).
- Blank lines do not end a bullet when the following line is indented: indented text keeps continuing the bullet above. An unindented line after a blank line is not attributed to the bullet above; it is rejected at its own line (`PLAN_STRAY_CONTENT`). The rest of that rejected paragraph (no blank line between) is not reported again; a later blank-separated paragraph is its own stray. Unindented text directly under a bullet with no blank line is a Markdown lazy continuation and stays part of the bullet. Headings must start in column 1; an indented `#` line is bullet continuation text, not a heading.
- Content that no bullet can take is not always `PLAN_STRAY_CONTENT`. Unindented text directly under `## Phase details` with no `### Pn` block open, or directly under a `### Pn` block before any `####` sub-section opens (`#### Requirements`, `#### Constraints`, `#### Acceptance criteria`, or `#### Depends on`), is `PLAN_SECTION_ORDER` with the phase-placement message (`Content under "## Phase details" must sit inside a "### Pn — <title>" block`, or the sub-section message). `PLAN_STRAY_CONTENT` keeps the cases above: unindented text after a blank line while a bullet is open.
- Limits: 40 000 characters and 20 phases. Input over 40 000 characters returns a single `PLAN_TOO_LONG` on line 1 before any scanning, so no other error is reported for it.
- Every error is reported in one pass with a line number. A plan that fails validation is never stored, so a missing phase detail is a rejection, not a partial plan.

## Consequences

- Publishing follows the `notify-user` guard: a team role other than `user`, with an active task. The backend is team-agnostic; the trio prompts instruct only `architect` and `product-manager`, only when the coordinator's request says `Plan: required`; the specifier only reads.
- The timeline renders a plan row with the parsed structure and falls back to plain markdown when parsing fails.
- A reader on a fresh session has one way to recover a phase: `chatroom plan read --plan-id --phase`. Reconstructing a plan from prose is treated as a defect.
