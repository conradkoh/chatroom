import { handoffCommand } from '../cli/handoff/command';
import type { HandoffTemplateQuery } from '../cli/handoff-templates/contracts';

/** Body for a planner delegating a code review to the reviewer. */
export function getEntryPointToReviewerHandoffTemplate(query: HandoffTemplateQuery): string {
  const entryPoint = query.fromRole;

  return `Pass the review target and the review focus. State the exact commit range, branch, pull request, or file list to inspect, the focus areas (for example security, correctness, or test quality), and any known context or constraints. Ask the reviewer for a report only: do not edit files, run builds or tests, or implement fixes.

### When to review

Review before delivery for code-producing work:
- a builder slice has just completed and is about to be delivered;
- the user asks for a code review;
- a change is large, risky, or touches security-sensitive or shared code.

Skip review for a trivial edit that has already been verified.

After completing the review, the reviewer must return its issue report to \`${entryPoint}\` with the normal handoff command.

\`\`\`bash
${handoffCommand({
  chatroomId: '<chatroom-id>',
  role: entryPoint,
  nextRole: 'reviewer',
  cliEnvPrefix: '',
})}
\`\`\``;
}

/** Body for the reviewer returning its issue report to the entry role. */
export function getReviewerToEntryPointHandoffTemplate(query: HandoffTemplateQuery): string {
  const entryPoint = query.toRole;

  return `Instructions (not part of the message): Return a complete review report for the target the planner named. The reviewer is advisory: do not edit files, implement fixes, run builds or tests, or propose architecture rewrites beyond each issue's suggested fix. Report only what you observed and mark anything unverified as such. Label every issue with a severity: \`blocker\`, \`major\`, \`minor\`, or \`nit\`. Group the issues by severity with blockers first, and cite the repository-relative file and line or line range for each. Use the exact sections below, in this order.

## Summary
<one to three sentences: overall state of the target and the count of blocker/major issues>

## Review scope
<commits, paths, and PR/branch inspected; commands run, if any>

## Issues
<numbered list grouped by severity (blocker, major, minor, nit); each item: \`file:line\` — summary — evidence — suggested fix; write exactly \`None observed.\` if none>

## Not reviewed
<anything out of scope or unreadable; write exactly \`None.\` if none>

Instructions after the body (not part of the message): run the normal handoff command to \`${entryPoint}\` with the complete body above, then stop.

\`\`\`bash
${handoffCommand({
  chatroomId: '<chatroom-id>',
  role: 'reviewer',
  nextRole: entryPoint,
  cliEnvPrefix: '',
})}
\`\`\``;
}
