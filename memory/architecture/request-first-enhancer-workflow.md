---
type: decision-log
title: Request-first enhancer workflow
description: Use a memoryless enhancer once per user request as the first planning input to a stateful Solo or Duo entry point.
tags: [enhancer, planner, solo, workflow, prompts, cost]
status: stable
---

# Request-first enhancer workflow

## Context

The original enhancer reviewed planner-authored grounding and a draft builder handoff. That made the enhancer depend on context already compressed by the planner and required it to understand planner→builder and planner→user templates. Repeating the review before builder slices also spent tokens after the planner's context had begun to rot.

The persistent team entry point and enhancer have different useful properties: the `planner` in Duo and `solo` in Solo preserve memory across the task, while the enhancer provides stronger but memoryless single-turn analysis.

## Decision

When enabled, enhancement is the first action for a new user task:

1. The supported team entry point (`planner` for Duo, `solo` for Solo) immediately forwards only the user's request using the stripped `<request>` template.
2. The backend links the job to `originUserMessageId` and permits one enhancer job for that origin.
3. The enhancer downloads authoritative chatroom history from that origin, widens it when needed, and independently inspects the repository.
4. The enhancer returns structured planning input, not critique of a planner draft or a finished builder brief.
5. The stateful entry point uses that input as the starting point for its final plan and retains responsibility for implementation or delegation, verification, and user delivery.

Later implementation and builder handbacks never retrigger the enhancer.

## Boundaries

The enhancer receives its output contract, stripped request, origin identifier, role instructions, and a **handoff** completion command (`chatroom handoff --role=enhancer`). It does not receive entry-point grounding, a draft, downstream handoff templates, or user-report requirements. The deprecated `chatroom enhancer complete` CLI was removed; daemon salvage may still call the deprecated backend complete mutation when the agent exits without handoff.

Supported team capability is defined once in `packages/shared/src/domain/enhancer-team-capability.ts`, which is consumed by the web controls, prompt delivery, and backend handoff authorization. The enhancer remains transient and returns to the configured persistent entry point; it is never added to `teamRoles`.

Persisted names `targetId: 'handoff:planner-to-builder'`, `draftContent`, and optional `inputTemplateSnapshot` are retained solely for data compatibility. New prompt behavior must not infer the old review workflow from those names.

## Consequences

- Higher-quality analysis happens before entry-point context compression.
- Enhancer token spend is bounded to one pass per originating user request.
- The planner or solo agent remains the durable memory and workflow owner.
- Enhancer advice must reconstruct context from messages on every run; the exact origin ID and history-download instructions are therefore part of the runtime contract.
- Tests need negative assertions that entry-point drafts and downstream templates are absent from enhancer prompts.

## Related

The implementation reference is `docs/plans/enhancers.md` in the repository documentation. Stack and completion-path details: `/migrations/enhancer-handoff-only-stack.md`.
