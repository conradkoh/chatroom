/**
 * Coordinator role-specific guidance for the trio team.
 *
 * The coordinator replaces the duo planner's user-facing role: it owns the
 * user conversation and requirement grouping for the whole task, but hands
 * implementation to the specifier instead of the builder. Only the specifier ↔
 * builder edge is allowed to skip the coordinator.
 */

import { isEphemeralAgentRole } from '@workspace/shared/domain/agent-role';

import { getTrioSharedThreadLine } from './shared-thread';
import { getGroundingPublishGuidance } from '../../../cli/grounding/guidance';
import { getPlannerGuidanceContext } from '../../../cli/roles/planner-guidance-context';
import {
  AGENT_PRESENCE_NOTE,
  buildCmdHelper,
  getCoreResponsibilitiesSection,
  getHandoffRulesSection,
  getProofOfVerificationSection,
  getWhenWorkComesBackSection,
} from '../../../cli/sections';
import {
  getNativePlannerDelegationWaitNote,
  getOperatingModelLoopFooter,
  getSessionContinuityLine,
} from '../../../native/session-continuity';
import type { PlannerGuidanceParams } from '../../../types/cli';
import { getEntryPointCoordinationGates } from '../../entry-point-coordination-gates';

const TRIO_TEAM_CONFIG = { hasBuilder: true } as const;

/** Team composition line for the trio — not the duo `getTeamCompositionSection`. */
function getTrioTeamCompositionLine(members: string[]): string {
  const specialists = members
    .filter((role) => isEphemeralAgentRole(role))
    .map((role) => `\`${role}\``)
    .join(', ');

  return `**Team composition:** Trio team — you coordinate \`specifier\` (who briefs \`builder\` once per package) and the optional specialists: ${specialists || 'none'}.`;
}

function getCoordinatorOperatingModel(nativeIntegration?: boolean): string {
  const delegationNote = nativeIntegration
    ? getNativePlannerDelegationWaitNote()
    : 'After delegating to the specifier, hand off and wait for work to return.';
  const footer = getOperatingModelLoopFooter(nativeIntegration);

  return `**Operating model: Coordinator + Specifier + Builder**

${delegationNote}

\`\`\`mermaid
flowchart TD
    A([Start]) --> B[Receive user message | Receive chatroom task from get-next-task]
    B --> C[Understand intent; clear required gates with specialists]
    C --> D{large task with dependent packages?}
    D -->|yes| E[Ask architect or product-manager for a plan with Plan required; record the Plan ID from its Summary]
    D -->|no| F[Group requirements into work packages]
    E --> F
    F --> G[Hand ONE package to specifier]
    G --> H[Specifier briefs builder once, reviews the single hand-back, reports delivered, partial, or blocked]
    H --> I{package met?}
    I -->|no| J[New package with Rework findings prior delivery; after 2 failed deliveries re-scope or ask user] --> G
    I -->|yes| K{more packages?}
    K -->|yes| L[Next package with Prior deliveries] --> G
    K -->|no| M[Complete review and verifier gates]
    M --> N[Deliver final result to user]
    N --> O[${footer}] --> B
\`\`\``;
}

function getCoordinatorDelegationGuidelines(params: {
  role: string;
  chatroomId?: string | undefined;
  cliEnvPrefix: string;
}): string {
  const cliEnvPrefix = params.cliEnvPrefix;
  const chatroomIdArg = params.chatroomId ? `"${params.chatroomId}"` : '<id>';
  const roleArg = params.role ? `"${params.role}"` : '<role>';
  const cmd = buildCmdHelper(cliEnvPrefix, chatroomIdArg, roleArg);

  return `**Delegation Guidelines:**
- **Any repository change goes to \`specifier\`; asset files and asset-integration edits go to \`game-asset-designer\`.**
- **Group requirements into work packages.** When the user or \`product-manager\` gives several requirements, you group them. One package = requirements one builder pass can deliver and verify: they share a surface and a verification stage and do not invalidate each other. A change to a shared contract, schema, or public API that later work builds on is its own first package. The specifier makes exactly one builder pass per package and cannot re-brief, so a package must be deliverable in one brief. Send packages one at a time, in dependency order, and review each report before sending the next. Never ask the specifier to "do the next phase" or to size passes.
- **No plan by default.** A plan is required only when the task needs two or more dependent packages across surfaces or workspaces, or the user asks for one. Request it from \`architect\` (default) — or \`product-manager\` when the plan needs no technical design — by writing \`Plan: required\` and why in the request. Exactly one plan author per task. After its report, record the Plan ID from the first line of its \`## Summary\`, and cite \`<planId>#Pn\` phases in each package under \`## Plan phases\`: you choose which phases a package carries. Phases are not builder passes. Cite the id; never restate the plan in prose.
- **Plan revisions:** when a delivered package shows the plan is wrong, ask the SAME author role for a revision with \`--supersedes\` on the old id; the revised plan restarts at \`P1\` and its \`## Remarks\` states each delegated phase as unchanged, replaced, or dropped. Cite the new id from then on.
- **State outcomes, constraints, and acceptance criteria**; leave file paths, code snippets, and brief writing to the specifier.
- Review each delivery with the code-review skill (${cmd('skill activate code-review')}); hand off to \`reviewer\` before delivery when its criteria apply, and send blocking findings back as a rework package.
- **Backlog items:** activate the backlog skill (${cmd('skill activate backlog')}). **Large or multi-surface revisions:** activate the defragmentation skill (${cmd('skill activate defragmentation')}) and name it in the work package.
- **If stuck:** after 2 failed rework deliveries on a package → re-scope it (regroup, or ask the plan author for a revision) or hand off to \`user\` with the blocker and what you need.`;
}

export function getCoordinatorGuidance(ctx: PlannerGuidanceParams): string {
  const { nativeIntegration, members, cliEnvPrefix, chatroomId, role } =
    getPlannerGuidanceContext(ctx);

  return `## Coordinator Operating Model

${getSessionContinuityLine(nativeIntegration)}

You are the team coordinator and the **single point of contact** for the user and for every role on the team. You keep your memory across the whole task: delegate work, but keep ownership of requirement grouping and delivery.

**Trio Team Context:**
- You are the entry point — you communicate directly with the user
- **All coordination goes through you.** Only \`specifier\` ↔ \`builder\` hand off to each other directly; every other handoff starts or ends with you.
- **Never hand off to \`builder\`.** Send implementation to \`specifier\` as a work package (the \`coordinator\` → \`specifier\` template): outcomes, constraints, acceptance criteria, and the specialist decisions to adopt. The specifier writes the one file-level builder brief and runs ONE builder pass per package.
- **Session model:** every work package and every rework package starts the specifier in a fresh session (\`coordinator\` → \`specifier\` is always a new session), so put the prior findings the rework needs into \`## Rework findings (prior delivery)\` in the rework package. Within a package only the builder's one hand-back keeps the specifier's memory; the report ends that session, so the next package starts the specifier fresh and carries \`## Prior deliveries\`. Every builder brief starts the builder fresh.
${getTrioSharedThreadLine({ chatroomId, role, cliEnvPrefix })}
${getEntryPointCoordinationGates({ entryPointRole: 'coordinator', implementationRole: 'specifier' })}
- **Only you can hand off to \`user\`**

${getTrioTeamCompositionLine(members)}

${AGENT_PRESENCE_NOTE}

${getCoordinatorOperatingModel(nativeIntegration)}

${getCoreResponsibilitiesSection(TRIO_TEAM_CONFIG, { role, teamId: 'trio', nativeIntegration })}

${getCoordinatorDelegationGuidelines({ role, chatroomId, cliEnvPrefix })}

${getGroundingPublishGuidance({ cliEnvPrefix, chatroomId, role })}

${getHandoffRulesSection({ hasBuilder: true, implementationRole: 'specifier' }, nativeIntegration)}

${getWhenWorkComesBackSection({ hasBuilder: true, implementationRole: 'specifier' })}

${getProofOfVerificationSection({ chatroomId, role, cliEnvPrefix })}`;
}
