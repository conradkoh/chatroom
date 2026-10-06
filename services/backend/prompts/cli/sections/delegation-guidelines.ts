/**
 * Delegation guidelines section for the planner role.
 *
 * Delegation is template-driven: the planner hands focused slices
 * to the builder using the Delegation Brief.
 */

import type { TeamCompositionConfig } from './team-composition';

type CmdHelper = (subcommand: string) => string;

function buildCmdHelper(cliEnvPrefix: string, chatroomIdArg: string, roleArg: string): CmdHelper {
  return (subcommand: string) =>
    `\`${cliEnvPrefix}chatroom ${subcommand} --chatroom-id=${chatroomIdArg} --role=${roleArg}\``;
}

function getDelegationBriefReference(): string {
  return 'Use the **Handoff to `builder`** template in the task delivery `<handoff-templates>` section — follow that structure in your handoff message.';
}

function getSoloImplementationGuidelines(cmd: CmdHelper, feedingNote: string): string {
  return `**Implementation Guidelines:**

Break complex features into small, focused slices. For code review guidance, activate the \`code-review\` skill: ${cmd('skill activate code-review')}.

**UI work:** Describe the problem, desired outcome, affected surfaces, constraints, and evidence to the UI/UX engineer. Require a browser-rendered design and production UI test requirements before implementation. Write and run those tests before production UI edits; request missing evidence or design revisions from the engineer.

- Implement one slice at a time; each slice ≈ one focused review surface.
- Review your own work before moving on; re-validate after rework.
- ${feedingNote}.`;
}

function getBuilderDelegationGuidelines(
  cmd: CmdHelper,
  feedingNote: string,
  delegationBriefRef: string
): string {
  return `**Delegation Guidelines:**

Break features into focused slices and delegate all code changes to the builder. For code review guidance, activate the \`code-review\` skill: ${cmd('skill activate code-review')}.

**UI work:** Describe the problem, desired outcome, affected surfaces, constraints, and evidence to the UI/UX engineer before builder implementation. Include the engineer’s complete browser-rendered design and production UI test requirements in the builder brief. The engineer decides UI structure, styles, states, interactions, and tests; request missing evidence or revisions from the engineer.

**Default: delegate with a Delegation Brief.** ${delegationBriefRef}

**How to slice the work** — think about the phases a human engineer would actually go through to ship the work, then make each phase a slice. Some heuristics:

- Name concrete artifacts, list every file, and include enough detail that the builder cannot guess wrong.
- Define architecture, data, and API contracts in the brief. The UI/UX engineer defines UI design and tests; the builder runs the specified UI tests before production UI edits.
- **Spell out what to avoid** — anti-patterns and recurring mistakes you have seen from builders on similar work (scope creep, wrong abstractions, forbidden refactors).
- **One slice ≈ one focused review surface.** Split work that cannot be reviewed in one sitting.
- **Order by dependency**, not by team convention. A slice should be runnable/testable when its dependencies are done.
- **A slice is shippable only when verified end-to-end** — infra/helper files alone are not a complete slice.
- **Skip phases that don't apply** (e.g., no frontend for a backend-only change, no schema for a pure refactor).

**Code review:** Review code-producing work before delivery.

**Backlog items:** When the task originates from a backlog item, activate the backlog skill: ${cmd('skill activate backlog')}.

**Large or multi-surface revisions:** When refactoring, consolidating, or migrating many call sites, activate the defragmentation skill: ${cmd('skill activate defragmentation')}.

**If stuck:** After 2 failed rework attempts → replan or hand back to planner as blocked. No partial PR, \`mark-for-review\`, or user delivery.

**Review loop:**
- Review completed work before moving to the next slice.
- Send back with specific feedback if requirements aren't met.
- ${feedingNote}.

}`;
}

/**
 * Generate the Delegation Guidelines section.
 */
// fallow-ignore-next-line complexity
export function getDelegationGuidelinesSection(
  config: Pick<TeamCompositionConfig, 'hasBuilder'>,
  options?: {
    cliEnvPrefix?: string | undefined;
    chatroomId?: string | undefined;
    role?: string | undefined;
  }
): string {
  const feedingNote = config.hasBuilder
    ? 'Feed slices to the builder incrementally — one at a time, not all at once'
    : 'When implementing yourself, tackle one layer at a time — avoid large monolithic changes';

  const cliEnvPrefix = options?.cliEnvPrefix ?? '';
  const chatroomIdArg = options?.chatroomId ? `"${options.chatroomId}"` : '<id>';
  const roleArg = options?.role ? `"${options.role}"` : '<role>';
  const cmd = buildCmdHelper(cliEnvPrefix, chatroomIdArg, roleArg);

  if (!config.hasBuilder) {
    return getSoloImplementationGuidelines(cmd, feedingNote);
  }

  return getBuilderDelegationGuidelines(cmd, feedingNote, getDelegationBriefReference());
}
