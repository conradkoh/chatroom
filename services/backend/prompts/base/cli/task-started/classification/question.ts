/**
 * Question classification guidance for CLI task-started command.
 */

/**
 * Generate question classification guidance
 */
export function getQuestionClassificationGuidance(): string {
  return `
### Question Classification

**When to use:** When the user is asking for information, clarification, or needs help understanding something.

**Characteristics:**
- User is seeking knowledge or explanation
- No new code implementation required
- May need research or investigation
- Typically results in informational response

**Examples:**
- "How does JWT authentication work?"
- "What's the difference between REST and GraphQL?"
- "Can you explain this error message?"
- "How should I structure this database schema?"

**Workflow:**
1. Classify as \`question\`
2. Research or investigate the topic
3. Provide clear, helpful explanation
4. May hand off to user directly (no review needed for simple questions)
5. For complex questions that require implementation, consider reclassifying as \`new_feature\`

**Handoff Rules:**
- **Simple questions**: Can hand off directly to \`user\`
- **Complex questions requiring implementation**: Should hand off to \`reviewer\`
- **Questions that reveal new feature needs**: May need reclassification
`;
}
