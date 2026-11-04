/**
 * Key: `trio:coordinator->verifier@code` (bucket `code`; covers `code` and `code:enhanced`).
 * Trio coordinator → verifier code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getEntryPointToVerifierHandoffTemplate } from '../../verifier-handoff-templates';

export function getCoordinatorVerifierCodeTemplate(query: HandoffTemplateQuery): string {
  return getEntryPointToVerifierHandoffTemplate(query);
}
