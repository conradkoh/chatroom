/**
 * Follow-up classification guidance for CLI task-started command.
 */

/**
 * Generate follow-up classification guidance
 */
export function getFollowUpClassificationGuidance(): string {
  return `
### Follow-up Classification

**When to use:** When the user is responding to previous work, providing feedback, or requesting modifications to existing code.

**Characteristics:**
- User is referencing previous work or conversations
- May be requesting changes to existing implementation
- Could be feedback on delivered features
- Often requires understanding of prior context

**Examples:**
- "The login feature you built works, but can you add password reset?"
- "I tested the upload feature and found some issues..."
- "Can you modify the dashboard to show more data?"
- "The review feedback was helpful, I've made those changes"
- "This isn't quite what I meant, can we adjust the approach?"

**Workflow:**
1. Classify as \`follow_up\`
2. Review the previous work and context
3. Understand the user's feedback or request
4. Implement the requested changes
5. Test the modifications
6. Hand off according to the nature of changes

**Handoff Rules:**
- **Simple modifications**: May hand off directly to \`user\`
- **Code changes**: Should hand off to \`reviewer\`
- **Major changes**: Treat as \`new_feature\` (consider reclassification)

**Context Management:**
- Reference the previous work clearly
- Explain what changes were made and why
- Note any impacts on existing functionality
- Provide before/after comparisons when helpful

**Best Practices:**
- Acknowledge the user's feedback
- Explain your approach to addressing their concerns
- Test thoroughly to ensure you didn't break existing functionality
- Document any side effects or considerations
`;
}
