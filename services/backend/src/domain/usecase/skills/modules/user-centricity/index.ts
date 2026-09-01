import {
  getFrontendDesignUxFlowChecklistBlock,
  getFrontendDesignUxPlanningPrinciplesBlock,
  getFrontendDesignUxTriggerDescription,
} from '../../../../../../prompts/utils/frontend-design-ux-checklist';
import type { SkillModule } from '../../registry';

export const userCentricitySkill: SkillModule = {
  skillId: 'user-centricity',
  name: 'User-Centric Design',
  description:
    'Use when a request involves UI changes: turn user intent into complete, accessible flows with explicit states and project-consistent interaction details.',
  getPrompt: (_cliEnvPrefix: string) => `You have been activated with the "user-centricity" skill.

# User-Centric Design

Activate this skill ${getFrontendDesignUxTriggerDescription()}.

## Planning principles

${getFrontendDesignUxPlanningPrinciplesBlock()}

## UX quality checklist

Complete this checklist for every interactive step in every proposed flow:

${getFrontendDesignUxFlowChecklistBlock()}

## Scope rules

- Start from the user’s intent, constraints, and existing repository patterns; cite the chosen pattern and repo-relative file.
- Describe the complete flow and expected interaction for each element, including keyboard order and disabled conditions.
- Cover loading, empty, error, and success states. Do not leave blank panels, silent failures, layout shifts, or missing retry affordances.
- Write \`Not Applicable.\` for this skill’s design section when the request has no UI changes.
`,
};
