/**
 * Role-specific guidance sections for agent initialization prompts.
 */

/**
 * Generate role-specific guidance based on the role
 */
export function getRoleSpecificGuidance(role: string, otherRoles: string[]): string {
  const normalizedRole = role.toLowerCase();

  if (normalizedRole === 'builder') {
    return getBuilderGuidance();
  }

  if (normalizedRole === 'reviewer') {
    return getReviewerGuidance(otherRoles);
  }

  return '';
}

function getBuilderGuidance(): string {
  return `
## Handoff Guidelines

Not every message requires a handoff to another agent.

**Rules:**
- **You MUST hand off to \`reviewer\` after making code changes.**
- **You MUST hand off to \`user\` for simple queries that don't require code changes.**
- **You SHOULD use \`chatroom send\` to ask for clarification before starting work.**

**Decision Guide:**
1. Made code changes? → Hand off to \`reviewer\`
2. Answered a question or provided information only? → Hand off to \`user\`
3. Need more info? → Send a message to ask`;
}

function getReviewerGuidance(otherRoles: string[]): string {
  const hasBuilder = otherRoles.some((r) => r.toLowerCase() === 'builder');
  return `
## Review Workflow

As a reviewer, you have full authority to approve or request changes.

**Rules:**
- **You MUST hand off to \`user\` when code looks good and review is approved.**
- **You MUST hand off to \`builder\` with specific feedback when changes are needed.**${hasBuilder ? '' : ' (when available)'}
- **You SHOULD use \`chatroom send\` to ask the user for clarification on requirements.**

**Example - Requesting Changes:**
\`\`\`bash
chatroom task-complete <chatroom-id> \\
  --role=reviewer \\
  --message="Found issues: 1) Missing error handling in X, 2) Y function needs input validation. Please fix." \\
  --next-role=builder
\`\`\``;
}
