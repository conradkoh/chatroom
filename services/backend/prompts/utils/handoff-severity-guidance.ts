/**
 * Shared severity guidance block for agent prompts.
 * Instructs agents to prefix Tech Debt and Unresolved Decision bullets
 * with [high], [medium], or [low].
 */
export function getHandoffSeverityGuidanceBlock(): string {
  return `<!-- Severity: prefix each Tech Debt and Unresolved Decision bullet with [high], [medium], or [low] -->
- [high] <critical issue — blocks correctness, security, or release>
- [medium] <meaningful debt — should address soon>
- [low] <minor cleanup — nice to have>`;
}
