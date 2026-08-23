import type { SkillModule } from '../../registry';

export const defragmentationSkill: SkillModule = {
  skillId: 'defragmentation',
  name: 'Defragmentation Workflow',
  description:
    'Use for large or multi-surface system revisions: study surfaces, establish a golden path, migrate callers, and delete legacy implementations.',

  getPrompt: (_cliEnvPrefix: string) => `You have been activated with the "defragmentation" skill.

# Defragmentation Workflow

Apply this workflow when the user request involves a large or multi-surface system revision, including refactoring, consolidation, or consistency work across many call sites.

## Workflow checklist

1. **Study surfaces** — map all call sites, use cases, and complexity variants before proposing slices; name every relevant file/module
2. **Golden implementation** — build a standalone canonical solution first; introduce canonical domain entities/types only when the studied variants require them, then shared use cases, UI components, or utilities; do not patch duplicates in place
3. **Migrate callers** — refactor all consumers to the golden path; each slice must be shippable end-to-end
4. **Delete legacy** — remove old implementations only after migration is complete; no dead-code leftovers

## Anti-patterns to flag

- Incremental copy-paste fixes across N files without a golden SSOT
- New abstraction without studying all existing variants
- Leaving old code "for safety" after migration
- Slices that add helpers/infra without a runnable end-to-end outcome
- Parallel implementations coexisting without a deletion plan

## Structural decisions

- Identify SSOT locations for domain entities, shared use cases, and UI components
- Align with \`structural-decisions\` glossary: folder structure, file naming, interface locations
- Flag when the plan scatters the canonical implementation across unrelated modules

## How to apply

- Use this workflow to shape implementation slices and the recommended deletion plan
- Each delegation slice must be end-to-end shippable before starting the next
- Do not leave legacy paths "for safety" after migration — deletion is part of the workflow`,
};
