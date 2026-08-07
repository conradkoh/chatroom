/**
 * Delegation brief disclosure attestation for builder Proof of Completion sections.
 */

const DELEGATION_BRIEF_DISCLOSURE_CHECKBOX =
  '- [ ] I confirm the delegation brief is fully met: all (Required) files done, verified end-to-end, acceptance criteria pass';

function getDelegationBriefDisclosureComment(): string {
  return `<!-- Reference the ## Goal and ## Requirements (acceptance criteria) sections from the planner handoff you received. State the delegation goal and confirm it was achieved. -->`;
}

export function getDelegationBriefDisclosureBlock(): string {
  return `${DELEGATION_BRIEF_DISCLOSURE_CHECKBOX}\n${getDelegationBriefDisclosureComment()}`;
}
