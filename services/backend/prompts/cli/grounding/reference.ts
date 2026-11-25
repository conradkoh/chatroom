import { getTeamPreset } from '@workspace/shared/domain/team-presets';

import { groundingReadCommand } from './command';

const FENCE = '```';

export interface GroundingReferencePair {
  teamId: string;
  fromRole: string;
  toRole: string;
}

/**
 * True when a handoff template must carry the `## Grounding` reference: every
 * entry-point delegation to a non-user recipient, and trio specifier → builder.
 * Report templates back to the delegator and every template to `user` do not.
 */
// fallow-ignore-next-line complexity
export function pairCarriesGroundingReference(pair: GroundingReferencePair): boolean {
  const preset = getTeamPreset(pair.teamId);
  if (preset !== undefined && preset.entryPoint === pair.fromRole && pair.toRole !== 'user') {
    return true;
  }
  return pair.teamId === 'trio' && pair.fromRole === 'specifier' && pair.toRole === 'builder';
}

/** The reference block appended after the handoff body. Its fenced section is pasted verbatim into the sender's message. */
export function getGroundingReferenceBlock(q: {
  chatroomId?: string | undefined;
  toRole: string;
  cliEnvPrefix?: string | undefined;
}): string {
  const chatroomId = q.chatroomId ?? '<chatroom-id>';
  const prefix = q.cliEnvPrefix ?? '';
  const readCommand = groundingReadCommand({
    cliEnvPrefix: prefix,
    chatroomId,
    role: q.toRole,
    groundingId: '<groundingId>',
  });
  return [
    '### Grounding reference',
    'Add this section to your message. Replace the placeholder with the id of the newest grounding message you published for this request, or write `None.`.',
    '',
    `${FENCE}markdown`,
    '## Grounding',
    'Grounding ID: <groundingId>, or `None.`',
    `Read it: \`${readCommand}\``,
    'It records preliminary, factual observations from an earlier pass. Treat it as a starting point, not as verified truth: re-check every file, symbol and flow you rely on against the repository, and prefer the code where they differ.',
    FENCE,
  ].join('\n');
}
