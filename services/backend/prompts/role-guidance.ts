/**
 * Role guidance composer — shared by native init and get-role-guidance CLI.
 */

import { buildSelectorContext, getRoleGuidanceFromContext } from './selector-context';
import type { InitPromptInput } from './types/init-prompt';
import { isNativeHarness } from '../src/domain/entities/harness/types';

/** Compose role-specific operating-model guidance for the given harness context. */
export function composeRoleGuidance(input: InitPromptInput): string {
  const { chatroomId, role, teamId, teamName, teamRoles, teamEntryPoint, convexUrl } = input;
  const nativeIntegration = isNativeHarness(input.agentHarness);

  const selectorCtx = buildSelectorContext({
    role,
    teamRoles,
    teamId,
    teamName,
    teamEntryPoint,
    convexUrl,
    chatroomId,
    agentType: input.agentType,
    nativeIntegration,
  });

  return getRoleGuidanceFromContext(selectorCtx);
}
