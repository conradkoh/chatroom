---
type: best-practice
title: Builtin agent role contracts
description: Canonical ownership and verification path for adding builtin agent roles.
tags: [agents, roles, teams, contracts, testing]
status: stable
---

# Builtin agent role contracts

Builtin role visibility depends on several connected contracts. A successful prompt listing does not establish team membership or sidebar visibility, and a successful typecheck does not establish that a role is rendered in the browser. Keep membership authored once, derive consumer projections, and verify the real API and route.

## Ownership

| Concern                                             | Owner                                                                                                                                           | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role identity, lifecycle, and supported teams       | `packages/shared/src/domain/agent-role.ts`                                                                                                      | Each metadata key declares one lifecycle and explicit ordered team memberships.                                                                                                                                                                                                                                                                                                                                                                                                |
| Team IDs                                            | `packages/shared/src/domain/team-kind.ts`                                                                                                       | Backend adapters derive from the shared tuple.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Team structures and picker                          | `packages/shared/src/domain/team-presets.ts`; `apps/webapp/src/modules/chatroom/config/teams.ts`                                                | Presets derive from role metadata; the picker derives only permanent roles.                                                                                                                                                                                                                                                                                                                                                                                                    |
| Dedicated prompts                                   | `services/backend/prompts/teams/<team>/prompts/role-identity.ts` per preset team; dispatch through `services/backend/prompts/teams/registry.ts` | Each preset team's identity catalogue is typed over that team's roles, so a membership change fails to compile in that team's file only. `resolveRoleIdentity` is the only lookup. Team guidance and team context dispatch through the same registry. Unknown teams and roles outside a preset use the frozen legacy catalogue `services/backend/prompts/teams/custom/prompts/role-identity.ts`. Guarded by `services/backend/prompts/teams/role-identity-resolution.test.ts`. |
| Team handoff capabilities                           | `services/backend/prompts/teams/*/handoff-templates/`                                                                                           | Each role has a typed owner-matched contract for every team that declares it.                                                                                                                                                                                                                                                                                                                                                                                                  |
| Handoff graph enforcement and handoff session rules | `packages/shared/src/domain/team-presets.ts` (`handoffGraph`, `handoffSessionRules`)                                                            | Enforced teams advertise and accept only contract `returnsTo` targets; session rules override the inherited envelope policy per edge.                                                                                                                                                                                                                                                                                                                                          |
| Runtime capability coherence                        | `services/backend/prompts/cli/handoff-templates/contracts.ts`                                                                                   | Builtin validation checks membership, targets, and reciprocal capabilities.                                                                                                                                                                                                                                                                                                                                                                                                    |
| Visibility                                          | Chatroom structure/status APIs and the sidebar/settings surfaces                                                                                | Static membership remains present without machine, launch, configuration, or status rows.                                                                                                                                                                                                                                                                                                                                                                                      |

Per-team prompt ownership, the shared-mechanics exceptions, and the test that guards each rule are recorded in [team prompt isolation](../../memory/architecture/team-prompt-isolation.md).

## Add-role checklist

1. Edit shared agent-role metadata once: add the canonical key, singleton lifecycle, and explicit nonempty ordered memberships. Never edit generated preset role arrays.
2. Add the role's identity to each supported team's catalogue, `services/backend/prompts/teams/<team>/prompts/role-identity.ts`, typed `{ [R in BuiltinTeamRole<'<team>'>]: RoleIdentity }`. Add a typed role-owned handoff contract for each supported team under `services/backend/prompts/teams/<team>/handoff-templates/`, wired into that team's exhaustive capability catalog. The frozen `services/backend/prompts/teams/custom/prompts/role-identity.ts` is typed over every builtin role, so the compiler also requires an entry there; preset-team members never read it. A role in an `enforced` team must have contracts whose `returnsTo` is the complete allowed target set.
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
  prompts/teams/role-identity-resolution.test.ts \
  prompts/teams/team-prompt-modules.test.ts \
  prompts/teams/team-isolation.test.ts \
  prompts/teams/duo/duo-role-prompts.snapshot.test.ts \
  prompts/teams/solo/solo-role-prompts.snapshot.test.ts \
  prompts/teams/trio/trio-role-prompts.snapshot.test.ts \
  prompts/teams/custom/custom-role-prompts.snapshot.test.ts \
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
