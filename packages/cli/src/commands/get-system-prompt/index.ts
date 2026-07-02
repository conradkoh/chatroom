/**
 * Get System Prompt CLI Command
 *
 * Fetches the full agent system prompt for a given role in a chatroom.
 * Useful for self-refresh after a crash or context compaction.
 */

import { Effect } from 'effect';

import type { GetSystemPromptDeps } from './deps.js';
import { api } from '../../api.js';
import type { SessionService } from '../../infrastructure/services/index.js';
import { BackendService } from '../../infrastructure/services/index.js';
import {
  loadChatroomTeamContext,
  runPromptFetchEffect,
  type PromptFetchError,
  type PromptFetchOptions,
} from '../prompt-fetch/shared.js';

export type { GetSystemPromptDeps } from './deps.js';
export type GetSystemPromptOptions = PromptFetchOptions;
export type GetSystemPromptError = PromptFetchError;

// fallow-ignore-next-line unused-export
export const getSystemPromptEffect = (
  chatroomId: string,
  options: GetSystemPromptOptions
): Effect.Effect<void, GetSystemPromptError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const { role } = options;
    const { convexUrl, chatroom } = yield* loadChatroomTeamContext(chatroomId);
    const backend = yield* BackendService;

    const prompt = yield* backend
      .query<string>(api.prompts.webapp.getAgentPrompt, {
        chatroomId,
        role,
        teamId: chatroom.teamId,
        teamName: chatroom.teamName,
        teamRoles: chatroom.teamRoles,
        teamEntryPoint: chatroom.teamEntryPoint,
        convexUrl: convexUrl ?? undefined,
      })
      .pipe(Effect.mapError((cause): GetSystemPromptError => ({ _tag: 'BackendError', cause })));

    yield* Effect.sync(() => {
      console.log(prompt);
    });
  });

export async function getSystemPrompt(
  chatroomId: string,
  options: GetSystemPromptOptions,
  deps?: GetSystemPromptDeps
): Promise<void> {
  await runPromptFetchEffect(getSystemPromptEffect(chatroomId, options), 'system prompt', deps);
}
