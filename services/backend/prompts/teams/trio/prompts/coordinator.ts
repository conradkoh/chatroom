/**
 * Coordinator role-specific guidance for the trio team.
 *
 * The coordinator replaces the duo planner's user-facing role: it owns the
 * user conversation and the whole-task plan, but hands implementation to the
 * specifier instead of the builder. Only the specifier ↔ builder edge is
 * allowed to skip the coordinator.
 */

import { isEphemeralAgentRole } from '@workspace/shared/domain/agent-role';

import { getTrioSharedThreadLine } from './shared-thread';
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

  return `**Team composition:** Trio team — you coordinate \`specifier\` (who directs \`builder\`) and the optional specialists: ${specialists || 'none'}.`;
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
    C --> D[Hand the request and the plan context to specifier; first pass has Plan ID None]
    D --> E[Specifier chooses the work and drives the builder through the phases it decides]
    E --> F[Specifier reports what it delivered, the plan id, and what remains]
    F --> G{round meets the request?}
    G -->|no| H[Hand back to specifier with rework findings] --> E
    G -->|yes| I{plan complete?}
    I -->|no| N[Plan still has work: remind the specifier what is delivered and what remains; it chooses the next round] --> E
    I -->|yes| J[Complete review and verifier gates]
    J --> K[Deliver final result to user]
    K --> L[${footer}] --> B
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
- **The specifier decides the work.** You state the outcome, the user's requirements and constraints, the decisions from specialist gates, and the delivery expectations. It decides the slices, which phases it delegates in a round, and when to report. You cannot judge that without the code in front of you, so do not size its rounds or ask for one slice at a time.
- **You hold the plan.** Record the plan id from its first report. The first package for a request carries \`Plan ID: None — first pass: publish the plan\`. When the plan still has work, remind it what the plan already delivered and what remains; it decides what to take next. Cite the plan id, never restate the plan in prose.
- **Revisions:** when a reviewed round shows the plan is wrong or incomplete, ask it to publish a revision with \`--supersedes\` on the old plan ID; the revision's \`## Remarks\` states, per delegated phase, unchanged / replaced / dropped. Cite the new plan id from then on.
- **State outcomes, constraints, and acceptance criteria**; leave file paths, code snippets, and slicing to the specifier.
- Review each round with the code-review skill (${cmd('skill activate code-review')}); hand off to \`reviewer\` before delivery when its criteria apply, and send blocking findings back as rework.
- **Backlog items:** activate the backlog skill (${cmd('skill activate backlog')}). **Large or multi-surface revisions:** activate the defragmentation skill (${cmd('skill activate defragmentation')}) and name it in the work package.
- **If stuck:** after 2 failed rework rounds on a package → replan it, or hand off to \`user\` with the blocker and what you need.`;
}

export function getCoordinatorGuidance(ctx: PlannerGuidanceParams): string {
  const { nativeIntegration, members, cliEnvPrefix, chatroomId, role } =
    getPlannerGuidanceContext(ctx);

  return `## Coordinator Operating Model

${getSessionContinuityLine(nativeIntegration)}

You are the team coordinator and the **single point of contact** for the user and for every role on the team. You keep your memory across the whole task: delegate work, but keep ownership of the plan and its decisions.

**Trio Team Context:**
- You are the entry point — you communicate directly with the user
- **All coordination goes through you.** Only \`specifier\` ↔ \`builder\` hand off to each other directly; every other handoff starts or ends with you.
- **Never hand off to \`builder\`.** Send implementation to \`specifier\` as a work package (the \`coordinator\` → \`specifier\` template): outcomes, constraints, acceptance criteria, and the specialist decisions to adopt. The specifier writes the file-level builder briefs, chooses the phases each round delivers, and runs the build passes.
- **Session model:** every work package and every rework round starts the specifier in a fresh session (\`coordinator\` → \`specifier\` is always a new session), so put the prior findings the rework needs into \`## Rework findings (prior round)\` in the rework package. Within a round, the builder hand-backs keep the specifier's memory; the round report ends that session, so the next package starts the specifier fresh and carries \`Delivered so far\`. Every builder brief starts the builder fresh.
${getTrioSharedThreadLine({ chatroomId, role, cliEnvPrefix })}
${getEntryPointCoordinationGates({ entryPointRole: 'coordinator', implementationRole: 'specifier' })}
- **Only you can hand off to \`user\`**

${getTrioTeamCompositionLine(members)}

${AGENT_PRESENCE_NOTE}

${getCoordinatorOperatingModel(nativeIntegration)}

${getCoreResponsibilitiesSection(TRIO_TEAM_CONFIG, { role, teamId: 'trio', nativeIntegration })}

${getCoordinatorDelegationGuidelines({ role, chatroomId, cliEnvPrefix })}

${getHandoffRulesSection({ hasBuilder: true, implementationRole: 'specifier' }, nativeIntegration)}

${getWhenWorkComesBackSection({ hasBuilder: true, implementationRole: 'specifier' })}

${getProofOfVerificationSection({ chatroomId, role, cliEnvPrefix })}`;
}
