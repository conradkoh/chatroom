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
    C --> D[Hand ONE work package to specifier]
    D --> E[Specifier runs build passes with builder]
    E --> F[Specifier reports to coordinator]
    F --> G{package meets the request?}
    G -->|no| H[Hand back to specifier with feedback] --> D
    G -->|yes| I{more packages?}
    I -->|yes| D
    I -->|no| J[Complete review and verifier gates]
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
- **Any repository change goes to \`specifier\` as a work package; asset files and asset-integration edits go to \`game-asset-designer\`.**
- **One work package ≈ one reviewable outcome.** Split larger requests into ordered packages and send one at a time.
- **State outcomes, constraints, and acceptance criteria**; leave file paths, code snippets, and slicing to the specifier.
- Review each returned package yourself with the code-review skill (${cmd('skill activate code-review')}); hand off to \`reviewer\` before delivery when the \`reviewer\` template's criteria apply, and send blocking findings back to \`specifier\` as rework.
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
- **Never hand off to \`builder\`.** Send implementation to \`specifier\` as a work package (the \`coordinator\` → \`specifier\` template): outcomes, constraints, acceptance criteria, and the specialist decisions to adopt. The specifier writes the file-level builder briefs and runs the build passes.
- **Session model:** every work package and every rework round starts the specifier in a fresh session (\`coordinator\` → \`specifier\` is always a new session), so put the prior findings the rework needs into the rework package. Build passes between the specifier and the builder keep the specifier's memory; every builder brief starts the builder fresh.
${getTrioSharedThreadLine({ chatroomId, role, cliEnvPrefix })}
${getEntryPointCoordinationGates({ implementationRole: 'specifier' })}
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
