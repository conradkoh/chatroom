import { ATTACHMENTS_GUIDE_CONTENT } from '../../../../../../prompts/attachments/attachments-guide-content';
import type { SkillModule } from '../../registry';

export const attachmentsSkill: SkillModule = {
  skillId: 'attachments',
  name: 'Attachment Implementation Guide',
  description:
    'End-to-end guide for message attachments: compose UI, delivery paths (CLI/native/task-read), XML conventions, and checklist for adding new attachment types.',
  getPrompt: (_cliEnvPrefix: string) =>
    `You have been activated with the "attachments" skill.

${ATTACHMENTS_GUIDE_CONTENT}`,
};
