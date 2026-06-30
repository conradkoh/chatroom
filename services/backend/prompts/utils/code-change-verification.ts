/** Shared code-change verification attestation for handoff templates. */

const CODE_CHANGE_VERIFICATION_COMMAND = 'pnpm typecheck && pnpm test';

export const CODE_CHANGE_VERIFICATION_CONFIRMATION = `- [ ] I confirm that I have run \`${CODE_CHANGE_VERIFICATION_COMMAND}\` (only required if code changes were made)`;
