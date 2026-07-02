/**
 * Context read disclosure attestation for handoff Proof of Completion sections.
 */

import { contextReadCommand, type ContextReadParams } from '../cli/context/read';

const CONTEXT_READ_DISCLOSURE_CHECKBOX =
  '- [ ] I confirm that I read the current chatroom task context using the command below and that the goal stated in that context has been met';

/** HTML comment with the exact context read command. */
function getContextReadDisclosureComment(params: ContextReadParams = {}): string {
  const command = contextReadCommand(params);
  return `<!-- Read context before handoff if not already done this task: \`${command}\`. State the context goal and confirm it was achieved. -->`;
}

/** Checkbox + HTML comment for Proof of Completion sections. */
export function getContextReadDisclosureBlock(params: ContextReadParams = {}): string {
  return `${CONTEXT_READ_DISCLOSURE_CHECKBOX}\n${getContextReadDisclosureComment(params)}`;
}
