export function buildPlannerEntryClassificationNote(
  isEntryPoint: boolean,
  cliEnvPrefix: string,
  classifyExample: string
): string {
  if (!isEntryPoint) return '';

  return `
**Classification (Entry Point Role):**
As the entry point, you receive user messages directly. When you receive a user message:
1. First run \`${cliEnvPrefix}chatroom task read --chatroom-id="<chatroom-id>" --role="<role>" --task-id="<task-id>"\` to get the chatroom task content (auto-marks as in_progress)
2. Then run \`${classifyExample}\` to classify the original message (question, new_feature, or follow_up)
3. **If code changes or commits are expected**, create a new context before starting work (see Context Management in Available Actions)
4. Decompose the chatroom task into actionable work items if needed
5. Delegate to the appropriate team member or handle it yourself`;
}
