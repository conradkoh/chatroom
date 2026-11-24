/**
 * Shared code-change verification attestation for non-builder handoff templates.
 * Consumers: `utils/handoff-report-template-body.ts` (generic report body) and
 * `teams/trio/handoff-templates/specifier-coordinator-code.ts` (specifier → coordinator
 * code report). The builder hand-back uses BUILDER_CODE_CHANGE_VERIFICATION_CONFIRMATION
 * instead. Changing this text changes those consumers' output; keep them in step.
 */
export const CODE_CHANGE_VERIFICATION_CONFIRMATION =
  '- [ ] I confirm that I have run typecheck and tests for the project (only required if code changes were made)';

/**
 * Builder hand-back attestation. The brief flags each verification kind (typecheck, lint,
 * unit, integration, e2e) as `required` or `not applicable`, so the attestation covers the
 * lightweight checks plus every `required` kind, and records each `not applicable` kind.
 */
export const BUILDER_CODE_CHANGE_VERIFICATION_CONFIRMATION = [
  '- [ ] I confirm that the lightweight checks (typecheck and lint) ran on the code I changed',
  '- [ ] I confirm that every verification kind the brief marked `required` ran, and I recorded its command and result below',
  "- [ ] I confirm that every verification kind the brief marked `not applicable` is recorded below with the brief's reason",
].join('\n');
