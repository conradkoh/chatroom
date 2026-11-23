/**
 * Command generators for the plan CLI group.
 *
 * Single source of truth for every `chatroom plan …` example and actual
 * command, mirroring `cli/notify-user/command.ts`.
 */

import type { PlanPublishParams, PlanReadParams } from '../../types/cli';
import {
  formatStdinHeredocCommand,
  HANDOFF_MESSAGE_MARKER,
  PLAN_STDIN_DELIMITER,
} from '../stdin-heredoc';

const PLAN_BODY_PLACEHOLDER =
  '[Your plan markdown here — paste the filled template from `chatroom plan view-template`]';

function valueOrDefault(value: string | undefined, fallback: string): string {
  return value ?? fallback;
}

function commandDefaults(params: {
  cliEnvPrefix?: string | undefined;
  chatroomId?: string | undefined;
  role?: string | undefined;
}): { prefix: string; chatroomId: string; role: string } {
  return {
    prefix: valueOrDefault(params.cliEnvPrefix, ''),
    chatroomId: valueOrDefault(params.chatroomId, '<chatroom-id>'),
    role: valueOrDefault(params.role, '<role>'),
  };
}

export function planPublishCommand(params: PlanPublishParams): string {
  const { prefix, chatroomId, role } = commandDefaults(params);
  const commandPrefix = `${prefix}chatroom plan publish --chatroom-id="${chatroomId}" --role="${role}"`;
  return formatStdinHeredocCommand(commandPrefix, PLAN_STDIN_DELIMITER, PLAN_BODY_PLACEHOLDER, {
    messageMarker: HANDOFF_MESSAGE_MARKER,
  });
}

export function planReadCommand(params: PlanReadParams): string {
  const { prefix, chatroomId, role } = commandDefaults(params);
  const planId = valueOrDefault(params.planId, '<plan-id>');
  const phase = params.phase ? ` --phase="${params.phase}"` : '';
  return `${prefix}chatroom plan read --chatroom-id="${chatroomId}" --role="${role}" --plan-id="${planId}"${phase}`;
}
