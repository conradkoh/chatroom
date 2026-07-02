/**
 * Get Role Guidance CLI Command
 *
 * Fetches role-specific operating-model guidance for a chatroom role.
 * Useful after compaction when agents need a reminder without reloading the full system prompt.
 */

import { Effect } from 'effect';

import type { GetRoleGuidanceDeps } from './deps.js';
import { api } from '../../api.js';
import type { SessionService } from '../../infrastructure/services/index.js';
import { BackendService } from '../../infrastructure/services/index.js';
import {
  loadChatroomTeamContext,
  runPromptFetchEffect,
  type PromptFetchError,
  type PromptFetchOptions,
} from '../prompt-fetch/shared.js';

export type { GetRoleGuidanceDeps } from './deps.js';
export type GetRoleGuidanceOptions = PromptFetchOptions;
export type GetRoleGuidanceError = PromptFetchError;

// fallow-ignore-next-line unused-export
export const getRoleGuidanceEffect = (
  chatroomId: string,
  options: GetRoleGuidanceOptions
): Effect.Effect<void, GetRoleGuidanceError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const { role } = options;
    const { convexUrl, chatroom } = yield* loadChatroomTeamContext(chatroomId);
    const backend = yield* BackendService;

    const guidance = yield* backend
      .query<string>(api.prompts.webapp.getRoleGuidance, {
        chatroomId,
        role,
        teamId: chatroom.teamId,
        teamName: chatroom.teamName,
        teamRoles: chatroom.teamRoles,
        teamEntryPoint: chatroom.teamEntryPoint,
        convexUrl: convexUrl ?? undefined,
      })
      .pipe(Effect.mapError((cause): GetRoleGuidanceError => ({ _tag: 'BackendError', cause })));

    yield* Effect.sync(() => {
      console.log(guidance);
    });
  });

export async function getRoleGuidance(
  chatroomId: string,
  options: GetRoleGuidanceOptions,
  deps?: GetRoleGuidanceDeps
): Promise<void> {
  await runPromptFetchEffect(getRoleGuidanceEffect(chatroomId, options), 'role guidance', deps);
}
