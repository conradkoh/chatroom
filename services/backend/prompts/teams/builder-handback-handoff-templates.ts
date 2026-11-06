import type { HandoffTemplateQuery } from '../cli/handoff-templates/contracts';
import type { RoleGuidanceCommandParams } from '../cli/role-guidance/command';
import { CODE_CHANGE_VERIFICATION_CONFIRMATION } from '../utils/code-change-verification';
import { getDelegationBriefDisclosureBlock } from '../utils/delegation-disclosure';
import { getFileReferenceProofOfCompletionExample } from '../utils/file-reference-guidance';
import { getHandoffQualityPrinciplesSectionBlock } from '../utils/handoff-quality-principles';
import {
  getHandoffNotApplicableSectionComment,
  getHandoffReportTemplateIntro,
} from '../utils/handoff-section-guidance';
import { getRoleGuidanceDisclosureBlock } from '../utils/role-guidance-disclosure';

/** Returns the markdown handback template body the builder uses when returning work. */
export function getBuilderHandbackTemplate(query: HandoffTemplateQuery): string {
  const recipientRole = query.toRole;

  return getBuilderHandbackBody(
    {
      chatroomId: query.chatroomId,
      role: query.role,
      cliEnvPrefix: query.cliEnvPrefix,
    },
    recipientRole
  );
}

/** Renders the handback body for a recipient role. */
function getBuilderHandbackBody(
  roleGuidanceContext: RoleGuidanceCommandParams | undefined,
  recipientRole: string
): string {
  return `${getHandoffReportTemplateIntro()}

\`\`\`markdown
## Summary
<what was implemented or attempted, in plain terms>

## Template Disclosure Confirmation
- [ ] I confirm that I have seen this template at the start of this task, before implementing or modifying any code
${getRoleGuidanceDisclosureBlock(roleGuidanceContext)}

${getHandoffQualityPrinciplesSectionBlock()}

## Proof of Completion
${getDelegationBriefDisclosureBlock({ briefSourceRole: recipientRole })}
${getFileReferenceProofOfCompletionExample()}
<evidence the goal was met — list every file you modified; for each behavior the brief's \`## Test seams\` section names a seam for: the test name, the seam it calls, the failure output observed before the implementation, and the passing output after>

## Code Change Verification
${CODE_CHANGE_VERIFICATION_CONFIRMATION}

## Blockers / questions
${getHandoffNotApplicableSectionComment('List blockers')}
<anything needing ${recipientRole} decision>

## Notes for review
${getHandoffNotApplicableSectionComment('List review notes')}
<specific areas for ${recipientRole} to check; any test written at a seam other than the one the brief's \`## Test seams\` section named, and why>
\`\`\``;
}
