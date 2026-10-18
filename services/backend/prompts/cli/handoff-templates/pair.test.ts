/**
 * Unit tests for the pure pair-key primitives and error-message builders.
 */

import { describe, expect, test } from 'vitest';

import {
  formatHandoffPairLabel,
  formatHandoffTemplateCommand,
  formatHandoffTemplateKey,
  formatHandoffTemplatePairId,
  HandoffTemplatePairError,
  isConversationMode,
  isTeamPresetId,
  legacyRoleFlagsMessage,
  missingModeMessage,
  missingPairMessage,
  modeBucket,
  normalizeHandoffMode,
  normalizeHandoffRole,
  unknownFromRoleMessage,
  unknownModeMessage,
  unknownPairMessage,
  unknownTeamMessage,
  type HandoffTemplatePair,
} from './pair';

describe('normalizeHandoffRole', () => {
  test('trims, lowercases, and collapses empty input to undefined', () => {
    expect(normalizeHandoffRole(undefined)).toBeUndefined();
    expect(normalizeHandoffRole('')).toBeUndefined();
    expect(normalizeHandoffRole('   ')).toBeUndefined();
    expect(normalizeHandoffRole(' Planner ')).toBe('planner');
    expect(normalizeHandoffRole('BUILDER')).toBe('builder');
  });
});

describe('normalizeHandoffMode', () => {
  test('trims, lowercases, and collapses empty input to undefined', () => {
    expect(normalizeHandoffMode(undefined)).toBeUndefined();
    expect(normalizeHandoffMode('')).toBeUndefined();
    expect(normalizeHandoffMode('   ')).toBeUndefined();
    expect(normalizeHandoffMode(' CODE ')).toBe('code');
    expect(normalizeHandoffMode('Code:Enhanced')).toBe('code:enhanced');
  });
});

describe('isConversationMode', () => {
  test('accepts the canonical modes and rejects everything else', () => {
    expect(isConversationMode('chat')).toBe(true);
    expect(isConversationMode('code')).toBe(true);
    expect(isConversationMode('code:enhanced')).toBe(true);
    expect(isConversationMode('bogus')).toBe(false);
    expect(isConversationMode('')).toBe(false);
  });
});

describe('modeBucket', () => {
  test('maps chat to its own bucket and both code modes to the code bucket', () => {
    expect(modeBucket('chat')).toBe('chat');
    expect(modeBucket('code')).toBe('code');
    expect(modeBucket('code:enhanced')).toBe('code');
  });
});

describe('formatHandoffTemplateKey', () => {
  test('appends the mode bucket to the pair id', () => {
    expect(
      formatHandoffTemplateKey({
        pair: { teamId: 'duo', fromRole: 'planner', toRole: 'user' },
        mode: 'chat',
      })
    ).toBe('duo:planner->user@chat');
    expect(
      formatHandoffTemplateKey({
        pair: { teamId: 'duo', fromRole: 'planner', toRole: 'builder' },
        mode: 'code',
      })
    ).toBe('duo:planner->builder@code');
    expect(
      formatHandoffTemplateKey({
        pair: { teamId: 'duo', fromRole: 'planner', toRole: 'user' },
        mode: 'code:enhanced',
      })
    ).toBe('duo:planner->user@code');
  });
});

describe('isTeamPresetId', () => {
  test('accepts builtin presets and rejects everything else', () => {
    expect(isTeamPresetId('duo')).toBe(true);
    expect(isTeamPresetId('solo')).toBe(true);
    expect(isTeamPresetId('tri')).toBe(false);
    expect(isTeamPresetId('')).toBe(false);
  });
});

describe('formatHandoffTemplatePairId', () => {
  test('joins team, sender, and recipient', () => {
    expect(
      formatHandoffTemplatePairId({ teamId: 'duo', fromRole: 'planner', toRole: 'builder' })
    ).toBe('duo:planner->builder');
    expect(formatHandoffTemplatePairId({ teamId: 'solo', fromRole: 'solo', toRole: 'user' })).toBe(
      'solo:solo->user'
    );
  });
});

describe('formatHandoffPairLabel', () => {
  test('renders a backticked sender → recipient label', () => {
    expect(formatHandoffPairLabel({ fromRole: 'planner', toRole: 'builder' })).toBe(
      '`planner` → `builder`'
    );
  });
});

describe('formatHandoffTemplateCommand', () => {
  const pair: HandoffTemplatePair = { teamId: 'duo', fromRole: 'planner', toRole: 'builder' };

  test('renders the pair command without a CLI env prefix', () => {
    expect(formatHandoffTemplateCommand('view-template', pair)).toBe(
      'chatroom handoff view-template --from="planner" --to="builder" --team-id="duo"'
    );
  });

  test('prefixes the command with a CLI env prefix when given', () => {
    expect(formatHandoffTemplateCommand('list-templates', pair, 'CHATROOM_CONVEX_URL=x ')).toBe(
      'CHATROOM_CONVEX_URL=x chatroom handoff list-templates --from="planner" --to="builder" --team-id="duo"'
    );
  });

  test('writes the mode argument verbatim before --team-id when given', () => {
    expect(formatHandoffTemplateCommand('view-template', pair, '', 'chat')).toBe(
      'chatroom handoff view-template --from="planner" --to="builder" --mode="chat" --team-id="duo"'
    );
    expect(
      formatHandoffTemplateCommand('view-template', pair, '', '<chat|code|code:enhanced>')
    ).toBe(
      'chatroom handoff view-template --from="planner" --to="builder" --mode="<chat|code|code:enhanced>" --team-id="duo"'
    );
  });
});

describe('missingPairMessage', () => {
  test('lists both flags when neither is given', () => {
    expect(missingPairMessage('view-template', '--from, --to')).toBe(
      [
        'handoff view-template requires both --from and --to (missing: --from, --to). Handoff templates are keyed by the (sender, recipient) pair.',
        'Example: chatroom handoff view-template --from="planner" --to="builder" --mode="code" --team-id="duo"',
      ].join('\n')
    );
  });

  test('lists only the missing flag', () => {
    expect(missingPairMessage('list-templates', '--from')).toContain('(missing: --from).');
    expect(missingPairMessage('list-templates', '--to')).toContain('(missing: --to).');
  });
});

describe('missingModeMessage', () => {
  test('names --mode and shows a chat example', () => {
    expect(missingModeMessage('view-template')).toBe(
      [
        'handoff view-template requires --mode (missing: --mode). Handoff templates are keyed by the (sender, recipient) pair and the conversation mode.',
        'Example: chatroom handoff view-template --from="planner" --to="user" --mode="chat" --team-id="duo"',
      ].join('\n')
    );
  });
});

describe('unknownModeMessage', () => {
  test('names the valid modes', () => {
    expect(unknownModeMessage('bogus')).toBe(
      'Unknown mode "bogus". Valid modes: chat, code, code:enhanced.'
    );
  });
});

describe('legacyRoleFlagsMessage', () => {
  const header =
    'handoff view-template no longer accepts --role/--next-role. Handoff templates are keyed by the (sender, recipient) pair.';

  test('both legacy flags map to an explicit pair', () => {
    expect(
      legacyRoleFlagsMessage('view-template', {
        teamId: 'duo',
        legacyRole: 'planner',
        legacyNextRole: 'builder',
      })
    ).toBe(
      [
        header,
        'Use: chatroom handoff view-template --from="planner" --to="builder" --mode="<chat|code|code:enhanced>" --team-id="duo"',
      ].join('\n')
    );
  });

  test('a supplied mode is written into the rewritten command verbatim', () => {
    expect(
      legacyRoleFlagsMessage('view-template', {
        teamId: 'duo',
        legacyRole: 'planner',
        legacyNextRole: 'builder',
        mode: 'chat',
      })
    ).toBe(
      [
        header,
        'Use: chatroom handoff view-template --from="planner" --to="builder" --mode="chat" --team-id="duo"',
      ].join('\n')
    );
  });

  test('a known legacy role lists every pair from that role', () => {
    const pairs: readonly HandoffTemplatePair[] = [
      { teamId: 'duo', fromRole: 'planner', toRole: 'user' },
      { teamId: 'duo', fromRole: 'planner', toRole: 'builder' },
    ];
    expect(
      legacyRoleFlagsMessage('view-template', {
        teamId: 'duo',
        legacyRole: 'planner',
        rolePairs: pairs,
      })
    ).toBe(
      [
        header,
        'Pairs from "planner" in team "duo":',
        '  chatroom handoff view-template --from="planner" --to="user" --mode="<chat|code|code:enhanced>" --team-id="duo"',
        '  chatroom handoff view-template --from="planner" --to="builder" --mode="<chat|code|code:enhanced>" --team-id="duo"',
      ].join('\n')
    );
  });

  test('an unknown legacy role falls back to the generic pair usage', () => {
    expect(
      legacyRoleFlagsMessage('view-template', {
        teamId: 'duo',
        legacyRole: 'nobody',
        rolePairs: [],
      })
    ).toBe(
      [
        header,
        'Use: chatroom handoff view-template --from="<your-role>" --to="<recipient-role>" --mode="<chat|code|code:enhanced>" --team-id="duo"',
      ].join('\n')
    );
  });

  test('a lone legacy next-role fills the recipient placeholder', () => {
    expect(
      legacyRoleFlagsMessage('view-template', {
        teamId: 'duo',
        legacyNextRole: 'builder',
      })
    ).toBe(
      [
        header,
        'Use: chatroom handoff view-template --from="<your-role>" --to="builder" --mode="<chat|code|code:enhanced>" --team-id="duo"',
      ].join('\n')
    );
  });
});

describe('unknownTeamMessage', () => {
  test('names the known teams', () => {
    expect(unknownTeamMessage('tri')).toBe('Unknown team "tri". Known teams: duo, solo.');
  });
});

describe('unknownFromRoleMessage', () => {
  test('lists the catalog roles', () => {
    expect(
      unknownFromRoleMessage({ from: 'user', team: 'duo', roles: ['planner', 'builder'] })
    ).toBe(
      'Role "user" has no handoff templates in team "duo". Roles with handoff templates: planner, builder.'
    );
  });
});

describe('unknownPairMessage', () => {
  test('lists the valid recipients in contract order', () => {
    expect(
      unknownPairMessage({
        from: 'planner',
        to: 'solo',
        team: 'duo',
        recipients: ['user', 'builder', 'architect'],
      })
    ).toBe(
      'No handoff template for "planner" → "solo" in team "duo". Valid recipients for "planner": user, builder, architect.'
    );
  });
});

describe('HandoffTemplatePairError', () => {
  test('carries the error code and a descriptive name', () => {
    const error = new HandoffTemplatePairError('MISSING_PAIR', 'boom');
    expect(error.code).toBe('MISSING_PAIR');
    expect(error.name).toBe('HandoffTemplatePairError');
    expect(error.message).toBe('boom');
    expect(error).toBeInstanceOf(Error);
  });
});
