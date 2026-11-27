---
type: decision-log
title: Trio team coordination
description: Coordinator-centred enforced handoff graph and per-edge session policy for the Trio preset.
tags: [teams, trio, handoff, session-policy]
status: active
---

# Trio team coordination

Related: [Grounding messages](/architecture/grounding-messages.md).

## Context

The Trio preset separates coordination, specification, and implementation. The
risk is that a three-role team becomes another advisory mesh: every role can
reach every other role, and session boundaries depend on whatever each sender
task happened to carry. Trio instead has one coordination hub and explicit
session boundaries per handoff edge. The coordinator groups requirements into
work packages and a plan is optional; the decisions below define the delivery
flow.

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
5. **Superseded by decisions 8–11.** The specifier no longer chooses the round or holds the plan.
6. **Superseded by decisions 8–11.** The specifier no longer publishes or owns the plan message.
7. **Superseded by decisions 8–11.** Delegation cadence is no longer the specifier's call.
8. **One specifier pass per work package.** The specifier writes one complete brief, makes one builder handoff, reviews the single hand-back, reports `delivered | partial | blocked` to the coordinator, and stops. No in-package rework: rework, regrouping and the 2-failed-rework escalation (now "2 failed rework deliveries on a package") are the coordinator's. Why: each builder round trip breaks the specifier's prompt cache and runs it at long context; phase-by-phase delegation is slow for simple tasks. No edge or session-rule change.
9. **The coordinator groups requirements into sequential packages.** One package is what one builder pass can deliver and verify; a contract-changing package lands alone first; a package one brief cannot carry goes back to the coordinator with a proposed split before building.
10. **Plans are optional and not specifier-authored.** Default none; required only for two or more dependent packages or on user request; the architect (default) or product-manager publishes on a `Plan: required` request, one author per task; the coordinator cites `<planId>#Pn` under `## Plan phases`; the specifier only reads.
11. **Single-pass brief variant.** The trio brief has one full-scope verification definition; duo keeps `focused | round-final`.

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
- Specifier cost is bounded by one cache-breaking builder round trip per package:
  one brief, one builder pass, one report. Regrouping and rework are coordinator
  work packages.
