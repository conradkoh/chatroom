/**
 * Key: `trio:verifier->coordinator@code` (bucket `code`; covers `code` and `code:enhanced`).
 * Trio verifier → coordinator code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getVerifierToEntryPointHandoffTemplate } from '../../verifier-handoff-templates';

export function getVerifierCoordinatorCodeTemplate(query: HandoffTemplateQuery): string {
  return getVerifierToEntryPointHandoffTemplate(query);
}
