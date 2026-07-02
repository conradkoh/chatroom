/**
 * Role guidance disclosure attestation for handoff templates.
 */

import { roleGuidanceCommand } from '../cli/role-guidance/command';
import type { RoleGuidanceCommandParams } from '../cli/role-guidance/command';

const ROLE_GUIDANCE_DISCLOSURE_CHECKBOX =
  "- [ ] I confirm that I've read and followed the role guidance before starting any work";

/** HTML comment with the exact get-role-guidance command and static-content note. */
function getRoleGuidanceDisclosureComment(params: RoleGuidanceCommandParams = {}): string {
  const command = roleGuidanceCommand(params);
  return `<!-- Role guidance is static for your role and does not change between tasks. Run once if needed: \`${command}\`. You do not need to re-read it on every task if you have already read it once. -->`;
}

/** Checkbox + HTML comment for Template Disclosure Confirmation sections. */
export function getRoleGuidanceDisclosureBlock(params: RoleGuidanceCommandParams = {}): string {
  return `${ROLE_GUIDANCE_DISCLOSURE_CHECKBOX}\n${getRoleGuidanceDisclosureComment(params)}`;
}
