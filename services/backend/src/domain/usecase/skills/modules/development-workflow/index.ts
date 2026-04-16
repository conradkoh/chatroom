import type { SkillModule } from '../../registry';

export const developmentWorkflowSkill: SkillModule = {
  skillId: 'development-workflow',
  name: 'Development Workflow',
  description:
    'Standard development workflow for branching, PRs, releases, and CI/CD. Covers release branch creation, feature PRs, squash merging, and master deployment.',
  getPrompt: (_cliEnvPrefix: string) => `## Development & Release Flow

1. Check if there is an existing minor / patch release. Create a new release branch (e.g. \`release/1.0.1\`) if not yet available.
2. Update the versions in the package.json files in the repo (remember to check for monorepos with multiple packages)
3. Create a new PR from the release branch to the repo's default branch
4. Create a new feature branch from the release branch
5. Work on the feature and raise a PR to the release branch
`,
};
