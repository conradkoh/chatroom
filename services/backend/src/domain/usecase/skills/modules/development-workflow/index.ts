import type { SkillModule } from '../../registry';

export const developmentWorkflowSkill: SkillModule = {
  skillId: 'development-workflow',
  name: 'Development & Release Workflow',
  description:
    'Standard development and release process: create release branch, raise PRs against it, squash-merge changes, then merge to master.',

  getPrompt: (
    _cliEnvPrefix: string
  ) => `You have been activated with the "development-workflow" skill.

## Release Workflow

Follow this process to ship a new version:

### 1. Create a Release Branch and PR

- Branch from \`master\` as \`release/v<X.Y.Z>\`
- Update the \`version\` field in **all** \`package.json\` files:
  - \`package.json\` (root)
  - \`apps/webapp/package.json\`
  - \`packages/cli/package.json\`
  - \`services/backend/package.json\`
- Raise a PR from the release branch to \`master\` (e.g., "Release v1.34.0")

### 2. Raise Feature/Fix PRs Against the Release Branch

- All PRs for this release should target \`release/v<X.Y.Z>\`, **not** \`master\`
- Each PR should be a focused, reviewable unit of work

### 3. Squash-Merge Changes Into the Release Branch

- When a feature PR is approved, **squash-merge** it into the release branch
- This keeps the release branch history clean — one commit per feature/fix

### 4. Merge the Release Branch to Master

- When all changes are in and the release is ready, merge the release PR to \`master\`
- CI/CD will handle the rest automatically (deployment, npm publish, etc.)

---

## Commands Reference

\`\`\`bash
# Create release branch
git checkout master && git pull
git checkout -b release/v<X.Y.Z>

# Bump versions (update all 4 package.json files)
# Then commit and push

# Create release PR
gh pr create --base master --title "Release v<X.Y.Z>"

# Retarget an existing PR to the release branch
gh pr edit <PR_NUMBER> --base release/v<X.Y.Z>

# Squash-merge a feature PR into the release
gh pr merge <PR_NUMBER> --squash

# Merge release to master when ready
gh pr merge <RELEASE_PR_NUMBER> --merge
\`\`\`

---

## Rules

- Never merge feature PRs directly to \`master\` — always go through a release branch
- Use squash-merge for feature PRs into the release branch
- Use regular merge (not squash) for the release PR into \`master\` to preserve the squashed commits
- Version numbers must be consistent across all 4 \`package.json\` files`,
};
