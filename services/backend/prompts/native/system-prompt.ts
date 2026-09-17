import { composeEnhancerSystemPrompt } from '../enhancer/system-prompt';
import { getNativeCommandsReferenceSection } from '../sections/commands-reference';
import { getGeneralKnowledgeSections } from '../sections/general-knowledge';
import { getRoleGuidanceSection } from '../sections/role-guidance';
import { getRoleTitleSection } from '../sections/role-identity';
import { buildSelectorContext } from '../selector-context';
import type { InitPromptInput } from '../types/init-prompt';
import { composeSections } from '../types/sections';
import { getCliEnvPrefix } from '../utils/index';

/** Slim init for native harnesses: title, glossary, role guidance, commands + recovery. */
export function composeNativeSystemPrompt(input: InitPromptInput): string {
  const { chatroomId, role, teamId, teamName, teamRoles, teamEntryPoint, convexUrl } = input;

  // Ephemeral enhancer delivery rides the standard native spawn path: the
  // enhancer's role identity replaces the generic native sections so a slot
  // spawn and the enhancer-job spawn produce the same system prompt.
  if (role.toLowerCase() === 'enhancer') {
    return composeEnhancerSystemPrompt({
      chatroomId,
      cliEnvPrefix: getCliEnvPrefix(convexUrl),
      convexUrl,
      entryPointRole: teamEntryPoint,
    });
  }

  const selectorCtx = buildSelectorContext({
    role,
    teamRoles,
    teamId,
    teamName,
    teamEntryPoint,
    convexUrl,
    chatroomId,
    agentType: input.agentType,
    nativeIntegration: true,
  });

  const sections = [
    getRoleTitleSection(selectorCtx),
    ...getGeneralKnowledgeSections(
      { convexUrl, chatroomId, role, nativeIntegration: true, compactSkills: true },
      { includeHistory: false }
    ),
    getRoleGuidanceSection(selectorCtx),
    getNativeCommandsReferenceSection({ chatroomId, role, convexUrl }),
  ];

  return composeSections(sections);
}
