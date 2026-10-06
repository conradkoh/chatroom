---
type: best-practice
title: Builtin agent role contracts
description: Canonical ownership and verification path for adding builtin agent roles.
tags: [agents, roles, teams, contracts, testing]
status: stable
---

# Builtin agent role contracts

## UI/UX-directed implementation

UI fixes and interface design use a required engineer-first workflow:

1. The entry point states the observed UI problem, desired user outcome, constraints, affected surfaces, and existing evidence without prescribing a replacement UI.
2. The UI/UX engineer studies source markup and the rendered DOM/styles, then returns one browser-rendered target with exact HTML/classes/style dependencies for affected states and viewports. The handback includes the preview location and screenshot or DOM/computed-style evidence, plus the exact production UI tests and meaningful expected initial failure.
3. The entry point reviews the engineer’s evidence and includes the complete design and production UI test requirements in the implementation brief. The engineer decides UI structure, styles, states, interactions, and tests. Missing evidence and requests for design or test revisions go to the engineer through the entry point before implementation continues.
4. The builder (or solo implementer) writes and runs the specified production UI tests before production edits, records a design-relevant red result, implements, reruns to green, and compares production DOM/styles with the rendered target. A test that exercises only a mock of the target does not satisfy this gate.

The engineer owns UI structure, classes/styles, states, interactions, responsive behavior, and UI test requirements. The entry point owns coordination and architecture/data/API contracts. Temporary browser preview artifacts outside tracked repository files are allowed; the engineer does not edit tracked source or implement production UI. This is an instruction/template workflow backed by prompt-contract tests, not deterministic runtime enforcement of agent behavior.

Prompt-source owners are `services/backend/prompts/cli/roles/uiux-engineer.ts` and `services/backend/prompts/teams/uiux-engineer-handoff-templates.ts` for the design contract; `services/backend/prompts/cli/sections/delegation-guidelines.ts`, `operating-model.ts`, and `when-work-comes-back.ts` for coordinator flow; `services/backend/prompts/cli/roles/builder.ts` and `services/backend/prompts/teams/duo/handoff-templates/` for implementation and proof; and `services/backend/prompts/teams/solo/prompts/solo.ts` for solo implementation.

Builtin role visibility depends on several connected contracts. A successful prompt listing does not establish team membership or sidebar visibility, and a successful typecheck does not establish that a role is rendered in the browser. Keep membership authored once, derive consumer projections, and verify the real API and route.

## Ownership

| Concern                                       | Owner                                                                                            | Contract                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Role identity, lifecycle, and supported teams | `packages/shared/src/domain/agent-role.ts`                                                       | Each metadata key declares one lifecycle and explicit ordered team memberships.           |
| Team IDs                                      | `packages/shared/src/domain/team-kind.ts`                                                        | Backend adapters derive from the shared tuple.                                            |
| Team structures and picker                    | `packages/shared/src/domain/team-presets.ts`; `apps/webapp/src/modules/chatroom/config/teams.ts` | Presets derive from role metadata; the picker derives only permanent roles.               |
| Dedicated prompts                             | `services/backend/prompts/templates.ts`                                                          | Every builtin role has a key-matched prompt in the exhaustive builtin catalog.            |
| Team handoff capabilities                     | `services/backend/prompts/teams/*/handoff-templates/`                                            | Each role has a typed owner-matched contract for every team that declares it.             |
| Runtime capability coherence                  | `services/backend/prompts/cli/handoff-templates/contracts.ts`                                    | Builtin validation checks membership, targets, and reciprocal capabilities.               |
| Visibility                                    | Chatroom structure/status APIs and the sidebar/settings surfaces                                 | Static membership remains present without machine, launch, configuration, or status rows. |

## Add-role checklist

1. Edit shared agent-role metadata once: add the canonical key, singleton lifecycle, and explicit nonempty ordered memberships. Never edit generated preset role arrays.
2. Add a dedicated builtin `RoleTemplate` and a typed role-owned handoff contract for each supported team; wire both into their exhaustive capability catalogs.
3. Preserve permanent team entry points, unique membership orders, reciprocal handoff edges, custom-role behavior, retired-role fallback, and permanent-only picker behavior.
4. Run compiler negative fixtures, shared invariants, backend capability/API checks, rendered sidebar/settings checks, CLI preset checks, and the production-route sidebar E2E below.
5. When reporting visibility, record the source commit/branch, executed checks, actual browser/backend target, and whether the change is merged or deployed. A pushed commit is not necessarily merged or deployed. Finite tests reduce risk; they cannot guarantee every future defect is impossible.

## Required checks

The pull-request CI typecheck and focused test steps are defined in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). Run the matching suites locally:

```bash
pnpm turbo run typecheck --filter=@workspace/shared --filter=chatroom-cli --filter=@workspace/backend --filter=@workspace/webapp

pnpm --dir packages/shared exec vitest run src/domain/agent-role.test.ts src/domain/team-presets.test.ts

pnpm --dir services/backend exec vitest run \
  src/domain/entities/team-kind.spec.ts \
  src/domain/entities/team-presets.spec.ts \
  prompts/templates.test.ts \
  prompts/builtin-role-contracts.test.ts \
  prompts/cli/handoff-templates/index.test.ts \
  prompts/cli/handoff-templates/list-templates.test.ts \
  convex/agents.spec.ts \
  convex/chatroomTeamStructure.spec.ts

pnpm --dir apps/webapp exec vitest run \
  src/modules/chatroom/config/teams.spec.ts \
  src/modules/chatroom/components/AgentPanel/AgentPanel.test.tsx \
  src/modules/chatroom/components/AgentPanel/WorkspaceInlineAgentListPanel.test.tsx \
  src/modules/chatroom/components/AgentPanel/InlineAgentCard.test.tsx \
  src/modules/chatroom/hooks/useWorkspaceAgentQueries.test.ts

pnpm --filter chatroom-cli exec vitest run src/commands/team/team.test.ts
```

The shared typecheck includes `packages/shared/src/domain/agent-team-contracts.typecheck.ts`, and the backend typecheck includes `services/backend/prompts/cli/handoff-templates/builtin-contracts.typecheck.ts`. Their `@ts-expect-error` assertions ensure incomplete or mismatched builtin catalogs fail compilation. The actual deployment boundary and offline sidebar rendering are checked by:

```bash
pnpm --dir apps/webapp exec playwright test --config=tests/e2e/playwright.config.ts specs/downstream/agent-sidebar.spec.ts --project=chromium
```

That test creates isolated Duo and Solo rooms through the real API, reads the declared structure/status and launch-request APIs, and visits the authenticated chatroom route without machines, workspaces, configurations, or launch requests. See [E2E testing](../developer/e2e-testing.md#builtin-agent-sidebar-regression) for environment requirements and PR coverage.
