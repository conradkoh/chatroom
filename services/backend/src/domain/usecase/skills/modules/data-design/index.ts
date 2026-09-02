import { getDataQueryDesignTemplateBlock } from '../../../../../../prompts/utils/data-query-design';
import type { SkillModule } from '../../registry';

export const dataDesignSkill: SkillModule = {
  skillId: 'data-design',
  name: 'Data & Query Design',
  description:
    'Use when persistence or query patterns change: make schema, index, scan, timeout, and invalidation decisions explicit.',
  getPrompt: (_cliEnvPrefix: string) => `You have been activated with the "data-design" skill.

# Data & Query Design

Activate this skill when persistence or query patterns change. Keep small updates from causing broad cache invalidations, and use projections for high-frequency writes when appropriate.

${getDataQueryDesignTemplateBlock()}

## Scope rules

- Ground every table, index, and query decision in the repository’s existing schema and access patterns.
- Do not introduce hot/cold projections or indexes speculatively; justify them from write/read frequency and risk.
- Write \`Not Applicable.\` for this skill’s design section when the request has no persistence or query changes.
`,
};
