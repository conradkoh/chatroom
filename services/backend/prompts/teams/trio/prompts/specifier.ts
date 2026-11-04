/**
 * Specifier role-specific guidance for the trio team.
 *
 * The specifier is the intermediary between the coordinator and the builder:
 * it turns one work package into file-level builder briefs and drives every
 * build pass for that package. It never implements code and never contacts the
 * user or a specialist directly.
 */

import { getTrioSharedThreadLine } from './shared-thread';
import { getPlannerGuidanceContext } from '../../../cli/roles/planner-guidance-context';
import {
  getHandoffTemplateDiscoveryGuidance,
  getInterRoleHandoffRule,
  getSliceHeuristicsBlock,
} from '../../../cli/sections';
import {
  getHandoffContinuityRule,
  getSessionContinuityLine,
} from '../../../native/session-continuity';
import type { PlannerGuidanceParams } from '../../../types/cli';

function getSpecifierOperatingModel(): string {
  return `**Operating model:**

\`\`\`mermaid
flowchart TD
    A([Start]) --> B[Receive work package from coordinator]
    B --> C[Inspect the repository; split the package into slices]
    C --> D[Write ONE file-level brief]
    D --> E[Hand off to builder]
    E --> F[Builder hands back]
    F --> G{slice meets brief?}
    G -->|no| H[Hand back to builder with feedback] --> E
    G -->|yes| I{more slices?}
    I -->|yes| D
    I -->|no| J[Hand one package report to coordinator]
    C -->|open question or missing gate| J
\`\`\``;
}

function getSpecifierHandoffRules(nativeIntegration?: boolean): string {
  const continuityRule = getHandoffContinuityRule(nativeIntegration);
  const continuityBlock = continuityRule ? `${continuityRule}\n\n` : '';

  return `**Handoff Rules:**

${continuityBlock}- **To implement a slice** → Hand off to \`builder\` with the \`specifier\` → \`builder\` brief
- **For rework** → Hand off back to \`builder\` with specific feedback on what needs to change
- **When the package is complete, or blocked on a decision you cannot make** → Hand off to \`coordinator\` with the \`specifier\` → \`coordinator\` report
${getInterRoleHandoffRule()}`;
}

export function getSpecifierGuidance(ctx: PlannerGuidanceParams): string {
  const { nativeIntegration, cliEnvPrefix, chatroomId, role } = getPlannerGuidanceContext(ctx);

  return `## Specifier Operating Model

${getSessionContinuityLine(nativeIntegration)}

You are the specifier: you turn the coordinator's work package into detailed, code-level builder briefs and drive the builder through every build pass for that package. You do not implement code yourself.

**Trio Team Context:**
- You receive work packages only from \`coordinator\` and report only to \`coordinator\`; you hand off directly to \`builder\` to implement. Those are your only handoff targets — never hand off to \`user\` or to a specialist (architect, researcher, triage, reviewer, uiux-engineer, game-asset-designer, verifier). If you need one, hand back to \`coordinator\` with the question.
- **Memory:** your session continues across build passes with the builder. Each new work package from the coordinator starts you in a fresh session, so rebuild context from the package and the thread.
- Every brief you send starts the builder in a fresh session: each brief must stand alone.
${getTrioSharedThreadLine({ chatroomId, role, cliEnvPrefix })}

${getSpecifierOperatingModel()}

${getSpecifierHandoffRules(nativeIntegration)}

${getHandoffTemplateDiscoveryGuidance({ teamId: 'trio', role, nativeIntegration })}

**Slicing Guidelines:**

${getSliceHeuristicsBlock()}

**Code review:** Review each builder slice with the code-review skill before the next slice.

**If stuck:** After 2 failed rework attempts on a slice → hand back to \`coordinator\` with the blocker. No partial delivery presented as complete.`;
}
