/**
 * Shared code-change verification attestation for handoff templates.
 *
 * Intentionally optional: agents should only run typecheck/test when they
 * modified code. Administrative tasks (release placeholders, docs-only PRs,
 * backlog triage) must not be blocked by this checkbox.
 */
const CODE_CHANGE_VERIFICATION_COMMAND = 'pnpm typecheck && pnpm test';

export const CODE_CHANGE_VERIFICATION_CONFIRMATION = `- [ ] I confirm that I have run \`${CODE_CHANGE_VERIFICATION_COMMAND}\` (only required if code changes were made)`;
