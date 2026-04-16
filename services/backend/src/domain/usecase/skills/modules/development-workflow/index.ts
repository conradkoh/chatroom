import type { SkillModule } from '../../registry';

export const developmentWorkflowSkill: SkillModule = {
  skillId: 'development-workflow',
  name: 'Development Workflow',
  description:
    'Standard development workflow for branching, PRs, releases, and CI/CD. Covers release branch creation, feature PRs, squash merging, and master deployment.',
  getPrompt: (cliEnvPrefix: string) => `# Development Workflow

## Release Process

Follow this workflow for every release cycle:

### 1. Create the next release branch

Branch from master and raise a PR targeting master:

\`\`\`bash
git checkout master && git pull
git checkout -b release/v<version>
\`\`\`

Update all \`package.json\` files with the new version number, then raise a PR:

\`\`\`bash
${cliEnvPrefix}chatroom backlog add --chatroom-id=<id> --role=<role> "Update package.json versions to v<version>"
# ... edit files ...
git add -A && git commit -m "chore: bump version to v<version>"
git push -u origin release/v<version>
gh pr create --base master --head release/v<version> --title "Release v<version>"
\`\`\`

### 2. Raise pull requests against the release branch

Feature and bug fix branches target the release branch:

\`\`\`bash
# Feature branches
git checkout -b feat/<feature-name>-v<version> release/v<version>

# Bug fix branches
git checkout -b fix/<fix-name>-v<version> release/v<version>

# After changes...
git push -u origin <branch-name>
${cliEnvPrefix}chatroom backlog add --chatroom-id=<id> --role=<role> "PR: <title>"
gh pr create --base release/v<version> --head <branch-name> --title "[<type>] <title>"
\`\`\`

### 3. Squash merge approved PRs into the release branch

When a PR is approved, squash merge it to keep the release branch history clean:

\`\`\`bash
gh pr merge --squash --admin --delete-branch
\`\`\`

### 4. Merge the release branch to master

When ready to ship, merge the release branch to master:

\`\`\`bash
git checkout master && git pull
git merge --no-ff release/v<version> -m "Merge release v<version>"
git push origin master
\`\`\`

CI/CD will automatically:
- Run tests and linting
- Publish packages to npm
- Deploy to staging/production

## Workflow Summary

| Step | Action | Target |
|------|--------|--------|
| 1 | Create release branch, update versions | \`release/v<version>\` from \`master\` |
| 2 | Raise feature/fix PRs | \`release/v<version>\` |
| 3 | Squash merge approved PRs | \`release/v<version>\` |
| 4 | Merge to master | \`master\` (CI/CD handles publishing) |
`,
};
