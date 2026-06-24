/**
 * Whether a task slice skips planner verification before user delivery.
 *
 * Detects explicit brief language (connectivity tests, builder handbacks with
 * no file changes, etc.) so delivery prompts do not mandate typecheck/test.
 */

const VERIFICATION_SKIP_PATTERNS: RegExp[] = [
  /\bdo\s+\*?\*?not\*?\*?\s+run\b[^\n]*\b(typecheck|test|verification)\b/i,
  /\bno code changes?\b/i,
  /\bconnectivity[- ](only|test)\b/i,
  /\bnot applicable\b[^\n]*(files? changed|verification|proof)/i,
  /##\s*proof[^\n]*\n[^\n]*not applicable/i,
  /##\s*verification\s*\n\s*not applicable/i,
];

function taskSkipsVerification(taskContent: string): boolean {
  return VERIFICATION_SKIP_PATTERNS.some((pattern) => pattern.test(taskContent));
}

export function getUserVerificationReminder(taskContent: string): string {
  if (taskSkipsVerification(taskContent)) {
    return 'No codebase verification needed for this slice (no implementation changes) — review the work and deliver to user.';
  }
  return 'Before handing off to user: verify the codebase is in a good state — run `pnpm typecheck && pnpm test`.';
}
