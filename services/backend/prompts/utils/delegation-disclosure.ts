/**
 * Delegation brief disclosure attestation for builder Proof of Completion sections.
 *
 * Builders validate against the planner's delegation brief (Goal + acceptance criteria),
 * not the chatroom context which may describe a broader multi-slice effort.
 */

const DELEGATION_BRIEF_DISCLOSURE_CHECKBOX =
  '- [ ] I confirm that the goal and acceptance criteria from the planner\u2019s delegation brief have been met';

const E2E_VERIFIED_CHECKBOX =
  '- [ ] I confirm the feature is verified end-to-end (CLI command runnable, API reachable, or UI action functional — not just helper files or unit tests)';

const NO_DEFERRED_REQUIRED_FILES_CHECKBOX =
  '- [ ] I confirm no (Required) files from the delegation brief were deferred or skipped';

/** HTML comment guiding the builder to reference the planner handoff. */
function getDelegationBriefDisclosureComment(): string {
  return `<!-- Reference the ## Goal and ## Requirements (acceptance criteria) sections from the planner handoff you received. State the delegation goal and confirm it was achieved. -->`;
}

/** Checkbox + HTML comment for builder Proof of Completion sections. */
export function getDelegationBriefDisclosureBlock(): string {
  return [
    DELEGATION_BRIEF_DISCLOSURE_CHECKBOX,
    E2E_VERIFIED_CHECKBOX,
    NO_DEFERRED_REQUIRED_FILES_CHECKBOX,
    getDelegationBriefDisclosureComment(),
  ].join('\n');
}
