/**
 * Role-specific guidance sections for agent initialization prompts.
 */

/**
 * Generate role-specific guidance based on the role
 */
export function getRoleSpecificGuidance(
  role: string,
  otherRoles: string[],
  isEntryPoint: boolean
): string {
  const normalizedRole = role.toLowerCase();

  if (normalizedRole === 'builder') {
    return getBuilderGuidance(isEntryPoint);
  }

  if (normalizedRole === 'reviewer') {
    return getReviewerGuidance(otherRoles);
  }

  return '';
}

function getBuilderGuidance(isEntryPoint: boolean): string {
  const classificationNote = isEntryPoint
    ? `
**Classification (Entry Point Role):**
As the entry point, you receive user messages directly. When you receive a user message:
1. First run \`chatroom task-started\` to classify it (question, new_feature, or follow_up)
2. Then do your work
3. Hand off to reviewer for code changes, or directly to user for questions`
    : '';

  return `
## Builder Workflow

You are responsible for implementing code changes based on requirements.
${classificationNote}

**Typical Flow:**
1. Receive task (from user or handoff from reviewer)
2. Implement the requested changes
3. Commit your work with clear messages
4. Hand off to reviewer with a summary of what you built

**Handoff Rules:**
- **After code changes** → Hand off to \`reviewer\`
- **For simple questions** → Can hand off directly to \`user\`
- **For \`new_feature\` classification** → MUST hand off to \`reviewer\` (cannot skip review)

**When you receive handoffs from the reviewer:**
You will receive feedback on your code. Review the feedback, make the requested changes, and hand back to the reviewer.`;
}

function getReviewerGuidance(otherRoles: string[]): string {
  const hasBuilder = otherRoles.some((r) => r.toLowerCase() === 'builder');
  return `
## Reviewer Workflow

You receive handoffs from the builder containing completed work. You do NOT receive user messages directly.

**Important: Do NOT run \`task-started\`** - The task has already been classified by the builder.

**Typical Flow:**
1. Receive handoff from builder with work summary
2. Review the code changes:
   - Check uncommitted changes: \`git status\`, \`git diff\`
   - Check recent commits: \`git log --oneline -10\`, \`git diff HEAD~N..HEAD\`
3. Either approve or request changes

**Your Options After Review:**

**If changes are needed:**
\`\`\`bash
# Inline (short feedback)
chatroom handoff <chatroom-id> \\
  --role=reviewer \\
  --message="Please address: 1) <issue>, 2) <issue>..." \\
  --next-role=builder

# From file (detailed feedback)
chatroom handoff <chatroom-id> \\
  --role=reviewer \\
  --message-file=/tmp/review-feedback.md \\
  --next-role=builder
\`\`\`

**If work is approved:**
\`\`\`bash
chatroom handoff <chatroom-id> \\
  --role=reviewer \\
  --message="APPROVED. <brief summary of what was reviewed and why it's good>" \\
  --next-role=user
\`\`\`

**Review Checklist:**
- [ ] Code correctness and functionality
- [ ] Error handling and edge cases
- [ ] Code style and best practices
- [ ] Documentation and comments
- [ ] Tests (if applicable)

${hasBuilder ? '**Important:** For multi-round reviews, keep handing back to builder until all issues are resolved.' : ''}`;
}
