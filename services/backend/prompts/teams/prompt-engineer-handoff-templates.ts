import { handoffCommand } from '../cli/handoff/command';
import type { HandoffTemplateQuery } from '../cli/handoff-templates/contracts';

/** Body for an entry point delegating a prompt-text design to the prompt engineer. */
export function getEntryPointToPromptEngineerHandoffTemplate(query: HandoffTemplateQuery): string {
  const entryPoint = query.fromRole;

  return `The automatically injected \`<user-message>\` is the authoritative request. Pass the agent behavior the prompt must produce, stop producing, or hand off differently; the roles and teams affected, with the responsibility each role owns and the context each role receives through its handoff; observed agent output that motivates the change (quote only the lines that carry the signal and redact secrets as \`<REDACTED>\`); the prompt files or symbols already suspected; and constraints (prior decisions, the specialist decisions already accepted). Ask the prompt engineer for a prompt-change brief only: do not edit files, run builds, tests, or snapshot updates, or publish plans.

### When to use the prompt engineer

Use it when agent-facing prompt text (role identity, role guidance, team context, handoff templates, or routing and delegation prose) needs a design decision:
- a new role's prompt text;
- a rewording that changes what an agent does or hands off;
- an edit to prompt text that several roles or teams render.

Skip it for a mechanical edit of already-decided text: a typo, a renamed identifier, or a snapshot update for agreed text. When the change also alters a handoff contract, API, or schema, \`architect\` designs that first.

After designing, the prompt engineer must return the prompt-change brief to \`${entryPoint}\` with the normal handoff command.

\`\`\`bash
${handoffCommand({
  chatroomId: '<chatroom-id>',
  role: entryPoint,
  nextRole: 'prompt-engineer',
  cliEnvPrefix: '',
})}
\`\`\``;
}

/** Body for the prompt engineer returning its prompt-change brief to the entry role. */
export function getPromptEngineerToEntryPointHandoffTemplate(query: HandoffTemplateQuery): string {
  const entryPoint = query.toRole;

  return `Instructions (not part of the message): Return one complete prompt-change brief for the authoritative request. The prompt engineer is advisory: do not edit files, run builds, tests, or snapshot updates, or publish plans. Decide the wording yourself; do not hand \`${entryPoint}\` alternative drafts. Cite concrete paths and symbols. If nothing should change, or the requested change would make a prompt contradict itself or another rule, say so in \`## Summary\`, write exactly \`No change proposed.\` under \`## Proposed text\`, and explain why. Use the exact sections below, in this order.

## Summary
<state the behavior change in two to four sentences and whether text is proposed>

## Roles and responsibilities
<one line per role the change touches: the role, the responsibility it owns, and the outcome it hands to another role>

## Cross-role interactions
<the high-level sequence: which role produces work for which other role, in what order, and what each interaction must carry>

## Handoff context audit
<for each receiving role: the context it actually gets through the handoff, how it learns the decisions made before it, and where an assumption about missing context can start; write exactly \`None observed.\` when the change crosses no role boundary>

## Prompt surfaces affected
<one line per changed path: the path, the unit that owns it (for example a team folder or a shared module), and its kind (role identity, role guidance, team context, handoff template, routing or delegation prose)>

## Proposed text
<for each path: the current excerpt, then the exact proposed text, ready to paste; concise, each requirement stated as a positive, specific instruction, with a negative rule only for a strict must-avoid case>

## Structured handoff updates
<for each grounding document or handoff template that must change: its path, the section names to add, remove, or reword, and the content each receiving role needs; write exactly \`None required.\` when no information must survive a role change>

## Audit test
<the cross-role test to add or update: its path, the roles and handoff order it encodes, the context each role receives, and the false assumption it must fail on; write exactly \`None required.\` when the change crosses no role boundary>

## Cross-team effect
<each team and role whose rendered prompt changes, and why; an edit to one team's own prompt must change no other team; write exactly \`None observed.\` when only the named unit changes>

## Snapshots and guards affected
<each snapshot or test that changes or must stay unchanged, and the import or isolation rule the change must respect>

## Acceptance criteria
<testable statements, one per bullet, each naming the rendered prompt and the text it must or must not contain>

## Open questions
<only a product-scope question for \`product-manager\`, a contract or schema question for \`architect\`, or an item that meets the escalation criteria for \`user\`; write exactly \`None observed.\` if none remain>

## Work completed
<paths, decision records and documentation, and snapshots inspected, with what each showed>

Instructions after the body (not part of the message): run the normal handoff command to \`${entryPoint}\` with the complete body above, then stop.

\`\`\`bash
${handoffCommand({
  chatroomId: '<chatroom-id>',
  role: 'prompt-engineer',
  nextRole: entryPoint,
  cliEnvPrefix: '',
})}
\`\`\``;
}
