import type { ActivatedSkillSnapshot } from '../types/init-prompt';
import type { PromptSection } from '../types/sections';
import { createSection } from '../types/sections';

export function getActivatedSkillsSection(skills: ActivatedSkillSnapshot[]): PromptSection | null {
  if (skills.length === 0) return null;
  const lines = [
    '# Activated Skills',
    '',
    'The following skills have been activated for this chatroom and role. Follow their guidance:',
    '',
  ];
  for (const skill of skills)
    lines.push(`## ${skill.name} (\`${skill.skillId}\`)`, '', skill.prompt, '');
  return createSection('activated-skills', 'knowledge', lines.join('\n'));
}
