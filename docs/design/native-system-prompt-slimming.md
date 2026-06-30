# Native System Prompt Slimming — Analysis

> Backlog: `ps78vcmhbqf6n4r40tyftgqepd89f6ab` — Improvement: Remove system prompt for all native agent harnesses

## Problem

Native integrations (cursor-sdk, pi-sdk, opencode-sdk) receive a large static system prompt on init. After compaction or `new_session` handoffs, harnesses may not retain this prompt reliably. Meanwhile, handoff templates already carry task-specific structure (delegation briefs, report templates, acceptance criteria).

The system prompt has become a second, hidden place where behavior is codified — often duplicating what handoff templates already enforce.

## What the system prompt currently contains

| Section                                            | Source                             | Keep for native?              | Rationale                                                |
| -------------------------------------------------- | ---------------------------------- | ----------------------------- | -------------------------------------------------------- |
| Glossary (session, chatroom-task, backlog, skills) | `sections/glossary.ts`             | **Yes (minimal)**             | Shared vocabulary agents need across turns               |
| Role identity (title, description)                 | `sections/role-identity.ts`        | **Maybe trim**                | Handoff templates name the role; title alone may suffice |
| Operating model / team composition                 | `cli/sections/operating-model.ts`  | **Move to handoff**           | Task-specific; belongs in planner→builder brief          |
| Commands reference                                 | `sections/commands-reference.ts`   | **Yes (native subset)**       | Agents still invoke `chatroom` CLI at runtime            |
| Getting started / recovery                         | `sections/getting-started.ts`      | **Yes (compact)**             | Needed after compaction to reload context                |
| Classification guide                               | `sections/classification-guide.ts` | **Remove for native**         | Native harnesses don't use classify flow                 |
| Handoff templates (embedded)                       | task delivery                      | **No — already in task body** | Duplicated when task-read injects templates              |
| Code-change verification mandates                  | handoff templates                  | **Handoff only**              | Already optional checkbox (#769)                         |
| Skills activation guidance                         | role prompts                       | **Trim**                      | Activate on task match; don't list all skills in init    |
| Workflow / squad-specific content                  | team prompts                       | **Remove**                    | Squad sunset; duo/solo use handoffs                      |

## Recommended phases

### Phase 1 (this release) — Analysis + guardrails

- Document this analysis (this file)
- Add regression test: native init prompt must not contain mandatory `pnpm typecheck` language
- Add regression test: native init prompt length budget (e.g. < N chars for cursor-sdk)

### Phase 2 — Slim native init prompt

- Introduce `composeNativeSystemPrompt()` that includes only: glossary, compact commands reference, compact recovery guidance
- Route native harnesses through slim composer in `generator.ts`
- Move operating-model paragraphs to handoff-only delivery

### Phase 3 — Handoff-first behavior

- Remove duplicated template text from static init where task delivery already injects it
- Validate cursor-sdk / pi-sdk / opencode-sdk across compaction + new_session flows

## What must NOT be removed

1. **Glossary** — agents need shared terms for backlog, attachments, handoff
2. **CLI command reference** — agents call `chatroom handoff`, `chatroom backlog`, etc.
3. **Compaction recovery** — `get-system-prompt` + `context read` after context loss
4. **Handoff templates in task delivery** — these are the primary behavior contract

## Success criteria

- Native harness init prompt is provably smaller (character count test)
- No behavior regression in integration tests for handoff, backlog, task-read
- Planner/builder handoff templates remain the single source for task structure
- Agents no longer receive contradictory instructions (system prompt vs handoff)

## Out of scope for Phase 1

- Removing system prompt entirely (native harnesses still need init context)
- Changing CLI harness behavior (non-native)
