---
type: decision-log
title: Enhancer handoff-only completion stack
description: Enhancer jobs complete via chatroom handoff; CLI complete removed; remote delivery uses standard task pipeline; ephemeral release on terminal task transitions.
tags: [enhancer, handoff, daemon, migration]
status: active
---

# Enhancer handoff-only completion stack

## Context

The enhancer previously completed via `chatroom enhancer complete`, which duplicated handoff delivery and left UI/status paths inconsistent. Remote daemon spawn used a separate envelope (`getSpawnPayload`) parallel to native task delivery. A follow-on bug left the ephemeral enhancer role stuck in WORKING because `skipAutoPromotion` incorrectly skipped ephemeral release on handoff task completion.

## Decision

Ship a four-PR enhancer stack on top of participant-decoupling PR3 (`feat/heartbeat-lifecycle-outbox`):

| PR             | Branch                                  | Scope                                                                                            |
| -------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| #1527          | `fix/enhancer-job-complete-on-handoff`  | Complete running enhancer job on `isEnhancerDelivery` handoff                                    |
| #1528          | `feat/enhancer-handoff-only-completion` | Remove `chatroom enhancer complete` CLI; align spawn envelope to handoff                         |
| #1529          | `feat/enhancer-task-delivery`           | `getTaskDeliveryForJob` + thin `job-subscriber`; deprecate `getSpawnPayload`                     |
| (fix on #1529) | same branch                             | `transitionTask` always releases ephemeral roles; `skipAutoPromotion` only skips queue promotion |

**Completion path:** enhancer agents run `chatroom handoff --role=enhancer --next-role=<entry-point>`. `web.enhancer.index.complete` remains `@deprecated` for daemon salvage only.

**Remote delivery:** daemon `job-subscriber` claims job → `getTaskDeliveryForJob` → standard `generateFullCliOutput` pipeline (same as native/get-next-task). System prompt still from `renderEnhancerSystemPrompt`.

**Ephemeral lifecycle:** `startEnhancerJobWork` sets enhancer read model WORKING on claim; terminal task transition calls `requestEphemeralAgentRelease` unconditionally (handoff uses `skipAutoPromotion: true` for promotion only).

## Consequences

- No agent-facing `enhancer complete` command; tests assert handoff in spawn/delivery output.
- `originUserMessageId` wired through task delivery for enhancer role guidance.
- Salvage: `applyEnhancerComplete` + deprecated complete mutation retained for agent exit without handoff.
- UI enhancer WORKING clears to OFFLINE after handoff when ephemeral release runs.

## Related

- `/architecture/request-first-enhancer-workflow.md`
- `docs/plans/enhancers.md`
- `/migrations/participant-decoupling-stack.md` (stack base)
