import { getNativeCommandsReferenceSection } from '../sections/commands-reference';
import { getGlossarySection } from '../sections/glossary';
import { getRoleGuidanceSection } from '../sections/role-guidance';
import { getRoleTitleSection } from '../sections/role-identity';
import { buildSelectorContext } from '../selector-context';
import type { InitPromptInput } from '../types/init-prompt';
import { composeSections } from '../types/sections';

/** Slim init for native harnesses: title, glossary, role guidance, commands + recovery. */
export function composeNativeSystemPrompt(input: InitPromptInput): string {
  const { chatroomId, role, teamId, teamName, teamRoles, teamEntryPoint, convexUrl } = input;
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
    getGlossarySection({
      convexUrl,
      chatroomId,
      role,
      nativeIntegration: true,
      compactSkills: true,
    }),
    getRoleGuidanceSection(selectorCtx),
    getNativeCommandsReferenceSection({ chatroomId, role, convexUrl }),
  ];

  return composeSections(sections);
}
