/**
 * Command generators for the grounding CLI group.
 *
 * Single source of truth for every `chatroom grounding …` example and actual
 * command, mirroring `cli/plan/command.ts`.
 *
 * Consumed by the grounding prompt modules and by `command.test.ts`; until the
 * prompts land, nothing outside the (ignored) test file imports it, so fallow
 * cannot see it as reachable.
 */
// fallow-ignore-file unused-file

import type { GroundingPublishParams, GroundingReadParams } from '../../types/cli';
import {
  formatStdinHeredocCommand,
  GROUNDING_STDIN_DELIMITER,
  HANDOFF_MESSAGE_MARKER,
} from '../stdin-heredoc';

const GROUNDING_BODY_PLACEHOLDER =
  '[Your grounding markdown here — paste the filled template from `chatroom grounding view-template`]';

function withDefaults(params: {
  cliEnvPrefix: string;
  chatroomId?: string | undefined;
  role?: string | undefined;
}): { prefix: string; chatroomId: string; role: string } {
  return {
    prefix: params.cliEnvPrefix,
    chatroomId: params.chatroomId ?? '<chatroom-id>',
    role: params.role ?? '<role>',
  };
}

export function groundingPublishCommand(params: GroundingPublishParams): string {
  const { prefix, chatroomId, role } = withDefaults(params);
  const commandPrefix = `${prefix}chatroom grounding publish --chatroom-id="${chatroomId}" --role="${role}"`;
  return formatStdinHeredocCommand(
    commandPrefix,
    GROUNDING_STDIN_DELIMITER,
    GROUNDING_BODY_PLACEHOLDER,
    { messageMarker: HANDOFF_MESSAGE_MARKER }
  );
}

export function groundingReadCommand(params: GroundingReadParams): string {
  const { prefix, chatroomId, role } = withDefaults(params);
  const groundingId = params.groundingId ?? '<grounding-id>';
  return `${prefix}chatroom grounding read --chatroom-id="${chatroomId}" --role="${role}" --grounding-id="${groundingId}"`;
}
