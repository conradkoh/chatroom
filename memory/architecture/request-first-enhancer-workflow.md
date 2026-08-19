---
type: decision-log
title: Request-first enhancer workflow
description: Use a memoryless enhancer once per user request as the first planning input to a stateful planner.
tags: [enhancer, planner, workflow, prompts, cost]
status: stable
---

# Request-first enhancer workflow

## Context

The original enhancer reviewed planner-authored grounding and a draft builder handoff. That made the enhancer depend on context already compressed by the planner and required it to understand planner→builder and planner→user templates. Repeating the review before builder slices also spent tokens after the planner's context had begun to rot.

The planner and enhancer have different useful properties: the planner preserves memory across the task, while the enhancer provides stronger but memoryless single-turn analysis.

## Decision

When enabled, enhancement is the first action for a new user task:

1. The planner immediately forwards only the user's request using the stripped `<request>` template.
2. The backend links the job to `originUserMessageId` and permits one enhancer job for that origin.
3. The enhancer downloads authoritative chatroom history from that origin, widens it when needed, and independently inspects the repository.
4. The enhancer returns structured planning input, not critique of a planner draft or a finished builder brief.
5. The stateful planner uses that input as the starting point for its final plan and retains responsibility for delegation, verification, and user delivery.

Builder handbacks return directly to the planner. They never retrigger the enhancer.

## Boundaries

The enhancer receives its output contract, stripped request, origin identifier, role instructions, and completion command. It does not receive planner grounding, a draft, downstream handoff templates, or user-report requirements.

Persisted names `targetId: 'handoff:planner-to-builder'`, `draftContent`, and optional `inputTemplateSnapshot` are retained solely for data compatibility. New prompt behavior must not infer the old review workflow from those names.

## Consequences

- Higher-quality analysis happens before planner context compression.
- Enhancer token spend is bounded to one pass per originating user request.
- The planner remains the durable memory and workflow owner.
- Enhancer advice must reconstruct context from messages on every run; the exact origin ID and history-download instructions are therefore part of the runtime contract.
- Tests need negative assertions that planner drafts and downstream templates are absent from enhancer prompts.

## Related

The implementation reference is `docs/plans/enhancers.md` in the repository documentation.
