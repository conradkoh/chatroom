// fallow-ignore-file unused-file unused-export
/**
 * Generated handoff templates for custom agents.
 *
 * A custom agent may author `inbound-handoff.md` / `return-handoff.md`, but both
 * files are optional. When the stored template row is absent, prompt
 * composition renders one of these defaults instead, so a teammate always knows
 * the shape of a handoff.
 *
 * Constraints (asserted in `default-handoff-templates.test.ts`):
 * - Markdown with `## ` sections only.
 * - Never contains a reserved handoff delimiter line, and never contains a
 *   reserved chatroom block tag, so the defaults can be rendered without
 *   neutralisation.
 *
 * Temporary: S4a ships these defaults ahead of the prompt wiring, so the
 * dead-code suppression above is needed until S4b consumes them.
 */

export function defaultInboundHandoffTemplate(agentName: string): string {
  return [
    '## Task',
    '',
    `State the task ${agentName} is being asked to take on, in one or two sentences.`,
    '',
    '## Context',
    '',
    'Give the background the task depends on: relevant files, links, decisions already made, and anything explicitly out of scope.',
    '',
    '## Expected result',
    '',
    `Describe the concrete outcome ${agentName} should return, and what must not change while producing it.`,
  ].join('\n');
}

export function defaultReturnHandoffTemplate(agentName: string, entryPoint: string): string {
  return [
    '## Summary',
    '',
    `${agentName} reports back to ${entryPoint} on the work just completed.`,
    '',
    '## Findings or result',
    '',
    'State the outcome plainly: what changed, what was verified, and any decision the rest of the team must know about.',
    '',
    '## Open issues',
    '',
    'List anything unresolved, blocked, or needing a decision. Write "None." when nothing is outstanding.',
  ].join('\n');
}
