import { buildCustomAgentSections } from '../custom-agents/render-custom-agent-sections';
import { getNativeCommandsReferenceSection } from '../sections/commands-reference';
import { getGeneralKnowledgeSections } from '../sections/general-knowledge';
import { getRoleGuidanceSection } from '../sections/role-guidance';
import { getRoleDescriptionSection, getRoleTitleSection } from '../sections/role-identity';
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

  const customSections = buildCustomAgentSections(input.customAgents);
  const sections = [
    getRoleTitleSection(selectorCtx),
    getRoleDescriptionSection(selectorCtx),
    ...customSections.afterRoleDescription,
    ...getGeneralKnowledgeSections(
      { convexUrl, chatroomId, role, nativeIntegration: true, compactSkills: true, teamId },
      { includeHistory: false }
    ),
    getRoleGuidanceSection(selectorCtx),
    ...customSections.afterRoleGuidance,
    getNativeCommandsReferenceSection({ chatroomId, role, convexUrl }),
  ];

  return composeSections(sections);
}
