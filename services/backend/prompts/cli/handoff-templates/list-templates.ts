/**
 * Handoff template discovery command — deterministic, local, static.
 *
 * No chatroom id and no network calls: the agent resolves one
 * `(team, sender → recipient)` pair and prints its descriptor, send command,
 * reply pair, and rendered template before work that may require a handoff.
 */

import {
  getReplyHandoffTemplatePair,
  renderHandoffTemplate,
  resolveHandoffTemplatePair,
} from './index';
import {
  HandoffTemplatePairError,
  formatHandoffPairLabel,
  formatHandoffTemplateCommand,
  formatHandoffTemplatePairId,
  unrenderablePairMessage,
  type HandoffTemplatePairInput,
} from './pair';
import { handoffCommand } from '../handoff/command';

/**
 * Resolves and formats one pair's handoff template.
 *
 * Throws {@link HandoffTemplatePairError} for missing/legacy/unknown pair input
 * so the CLI can report a clear nonzero error.
 */
export function listHandoffTemplatesCommand(
  params: HandoffTemplatePairInput & { cliEnvPrefix?: string | undefined }
): string {
  const pair = resolveHandoffTemplatePair(params, 'list-templates');
  const reply = getReplyHandoffTemplatePair(pair);
  const template = renderHandoffTemplate(pair, {
    nativeIntegration: true,
    cliEnvPrefix: params.cliEnvPrefix,
  });
  if (!template) {
    throw new HandoffTemplatePairError('UNKNOWN_PAIR', unrenderablePairMessage(pair));
  }

  const sendCommand = handoffCommand({
    chatroomId: '<chatroom-id>',
    role: pair.fromRole,
    nextRole: pair.toRole,
    cliEnvPrefix: params.cliEnvPrefix ?? '',
  }).split('\n')[0];

  return [
    `Handoff template ${formatHandoffPairLabel(pair)} (team: \`${pair.teamId}\`, key: \`${formatHandoffTemplatePairId(pair)}\`)`,
    `Send with: ${sendCommand}`,
    reply
      ? `Reply pair: ${formatHandoffPairLabel(reply)} (view: ${formatHandoffTemplateCommand('view-template', reply, params.cliEnvPrefix)})`
      : `Reply pair: none (\`${pair.toRole}\` replies free-form)`,
    '',
    template,
  ].join('\n');
}
