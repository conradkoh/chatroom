/**
 * Key: `duo:builder->planner@code` (bucket `code`; covers `code` and `code:enhanced`).
 * Builder → planner work-complete/blocked handback. Body only: the pair resolver
 * prepends the recipient callout and the title line.
 */

import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import type { RoleGuidanceCommandParams } from '../../../cli/role-guidance/command';
import { CODE_CHANGE_VERIFICATION_CONFIRMATION } from '../../../utils/code-change-verification';
import { getDelegationBriefDisclosureBlock } from '../../../utils/delegation-disclosure';
import { getFileReferenceProofOfCompletionExample } from '../../../utils/file-reference-guidance';
import { getHandoffQualityPrinciplesSectionBlock } from '../../../utils/handoff-quality-principles';
import {
  getHandoffNotApplicableSectionComment,
  getHandoffReportTemplateIntro,
} from '../../../utils/handoff-section-guidance';
import { getRoleGuidanceDisclosureBlock } from '../../../utils/role-guidance-disclosure';

/** Returns the markdown handback template body the builder uses when returning work. */
function getBuilderPlannerCodeBody(roleGuidanceContext?: RoleGuidanceCommandParams): string {
  return `${getHandoffReportTemplateIntro()}

\`\`\`markdown
## Summary
<what was implemented or attempted, in plain terms>

## Template Disclosure Confirmation
- [ ] I confirm that I have seen this template at the start of this task, before implementing or modifying any code
${getRoleGuidanceDisclosureBlock(roleGuidanceContext)}

${getHandoffQualityPrinciplesSectionBlock()}

## Proof of Completion
${getDelegationBriefDisclosureBlock()}
${getFileReferenceProofOfCompletionExample()}
A test seam is the public interface where a test observes behavior. Substitution in a test is allowed only at a port or adapter boundary (an external dependency injected through a port). Do not mock internal collaborators.
<evidence the goal was met — list every file you modified; for each behavior the brief's \`## Test seams\` section names a seam for: the test name, the seam it calls, the failure output observed before the implementation, and the passing output after>

## Code Change Verification
${CODE_CHANGE_VERIFICATION_CONFIRMATION}

## Blockers / questions
${getHandoffNotApplicableSectionComment('List blockers')}
<anything needing planner decision>

## Notes for review
${getHandoffNotApplicableSectionComment('List review notes')}
<specific areas for planner to check; any test written at a seam other than the one the brief's \`## Test seams\` section named, and why>
\`\`\``;
}

/** Code-bucket getter for the duo `builder` → `planner` handoff. */
export function getBuilderPlannerCodeTemplate(query: HandoffTemplateQuery): string {
  return getBuilderPlannerCodeBody({
    chatroomId: query.chatroomId,
    role: query.role,
    cliEnvPrefix: query.cliEnvPrefix,
  });
}
