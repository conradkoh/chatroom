import type { SkillModule } from '../../registry';

export const codeReviewSkill: SkillModule = {
  skillId: 'code-review',
  name: 'Code Review',
  description:
    'Use this skill when reviewing, auditing, or giving feedback on code. Covers eight pillars: simplification, type drift, duplication, design patterns, security, test quality, ownership/observability, and dead code elimination.',

  getPrompt: (_cliEnvPrefix: string) => `You have been activated with the "code-review" skill.

This skill conducts code reviews one pillar at a time through a structured workflow. You MUST follow each step exactly as disclosed by the workflow system — do not skip ahead or review pillars out of order.

## Activation

Start the sequential review workflow:

\`\`\`bash
chatroom workflow create-from-template --template=code-review --role=<your-role> --chatroom-id=<chatroom-id>
\`\`\`

Then follow the workflow instructions precisely:
- Use \`chatroom workflow step-view\` to read the current pillar's full content
- Review the code against ONLY that pillar
- When done, run \`chatroom workflow step-complete\` to advance to the next pillar
- Repeat until all 8 pillars are complete

Do NOT review pillars beyond the current step. The workflow system will disclose each pillar when it is time to review it.`,
};
