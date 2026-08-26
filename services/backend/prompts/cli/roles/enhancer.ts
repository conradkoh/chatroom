import { getEnhancerHistoryRetrievalGuidance } from '../../enhancer/history-retrieval';
import type { PlannerGuidanceParams } from '../../types/cli';
import { getCliEnvPrefix } from '../../utils/env';

export function getEnhancerGuidance(
  params: PlannerGuidanceParams & { entryPointRole?: string }
): string {
  const entryPoint =
    params.entryPointRole ??
    (params.teamRoles.some((role) => role.toLowerCase() === 'solo') ? 'solo' : 'planner');
  return [
    '## Enhancer Operating Model',
    'You are a single-turn, memoryless **design advisor**.',
    getEnhancerHistoryRetrievalGuidance({
      chatroomId: params.chatroomId ?? '',
      cliEnvPrefix: getCliEnvPrefix(params.convexUrl),
      originUserMessageId: undefined,
    }),
    '## What you must NOT do',
    '- Do NOT implement, spawn subagents, or propose multiple alternative designs.',
    '## Completion',
    `- Run \`chatroom handoff\` to \`${entryPoint}\` as your **final action** with the design-input template — not \`chatroom enhancer complete\`.`,
  ].join('\n\n');
}
