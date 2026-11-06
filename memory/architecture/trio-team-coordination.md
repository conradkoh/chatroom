---
type: decision-log
title: Trio team coordination
description: Coordinator-centred enforced handoff graph and per-edge session policy for the Trio preset.
tags: [teams, trio, handoff, session-policy]
status: active
---

# Trio team coordination

## Context

The Trio preset separates coordination, specification, and implementation. The
risk is that a three-role team becomes another advisory mesh: every role can
reach every other role, and session boundaries depend on whatever each sender
task happened to carry. Trio instead has one coordination hub and explicit
session boundaries per handoff edge.

## Decisions

1. **Coordinator-centred graph.** Trio declares `handoffGraph: 'enforced'`.
   The backend derives each role's advertised and accepted targets from that
   role's handoff contract `returnsTo` list, which is the source of truth; the
   preset does not restate them. Only `specifier` ↔ `builder` skips the
   coordinator. Every other route goes through `coordinator`, including
   specialist work and the final delivery to `user`. A handoff outside the
   sender's contract is rejected with `INVALID_TARGET_ROLE` and the contract
   targets as `suggestedTargets`, before any task, message, attachment, or usage
   write.
2. **Per-edge session policy.** Trio declares `handoffSessionRules` on the
   preset. A handoff starts from the created task's inherited envelope and, when
   a rule matches the edge, overrides only
   `TaskEnvelopeV1.sessionPolicy`. The policy stays on the target task's
   envelope (and its `startInNewSession` compatibility projection); it adds no
   schema field, index, or migration. Edges without a rule inherit the source
   task's envelope policy. In Trio: `coordinator` → `specifier` is `new`,
   `specifier` → `builder` is `new`, `builder` → `specifier` is `continue`, and
   any role → `coordinator` is `continue`.
3. **Fresh specifier sessions are deferred.** The specifier's `new` policy is
   applied to the task that a later `coordinator` → `specifier` handoff creates.
   A `builder` handback continues the specifier's session, so the specifier can
   review the slice in the context that wrote the brief. The fresh session takes
   effect when the next coordinator delegation is delivered.
4. **Advisory teams are unchanged.** Duo and Solo keep
   `handoffGraph: 'advisory'` and an empty rule list. They continue to inherit
   the sender task's envelope policy, and their configured-membership handoff
   lists are unaffected.

## Known gap

**Duo builder delegation still inherits `continue`.** In envelope-era tasks, a
duo `planner` → `builder` handoff inherits the planner task's envelope policy.
When that policy is `continue`, the duo builder does not start a fresh session,
which contradicts the duo brief line "Each builder delegation starts a fresh
session automatically" and `HARNESS_GUIDE.md` §"Builder delegation: always a
fresh session". This decision does not change duo behaviour; the brief and the
builder table are stale for those tasks and need a separate fix.

## Consequences

- The coordinator is the only role that can address `user` or a specialist, so
  the specifier and builder contracts cannot accidentally bypass coordination.
- Delivery prompts advertise exactly the contract targets and recommend the
  contract upstream (`returnsTo[0]`) as the primary return target; enforcement
  remains backend-side, not prompt-side.
- Removing a rule or the graph policy is a forward-only behaviour change: tasks
  already created keep their recorded envelope, so in-flight work is not
  retroactively re-routed.
