/**
 * Handoff view-template command: renders the template for one sender →
 * recipient pair.
 *
 * Pair resolution (including every user-facing error) lives in
 * `../handoff-templates/pair`; this module only maps a resolved pair to its
 * rendered template.
 */

import { renderHandoffTemplate, resolveHandoffTemplateSelection } from '../handoff-templates';
import {
  HandoffTemplatePairError,
  unrenderablePairMessage,
  type HandoffTemplatePairInput,
} from '../handoff-templates/pair';

export interface ViewHandoffTemplateParams extends HandoffTemplatePairInput {
  nativeIntegration?: boolean | undefined;
  cliEnvPrefix?: string | undefined;
}

export function viewHandoffTemplate(params: ViewHandoffTemplateParams): string {
  const { pair, mode } = resolveHandoffTemplateSelection(params, 'view-template');
  const template = renderHandoffTemplate(pair, {
    nativeIntegration: params.nativeIntegration ?? true,
    cliEnvPrefix: params.cliEnvPrefix,
    conversationMode: mode,
  });
  if (!template) {
    throw new HandoffTemplatePairError('UNKNOWN_PAIR', unrenderablePairMessage(pair));
  }
  return template;
}
