/**
 * Delegation brief disclosure attestation for builder Proof of Completion sections.
 */

const DELEGATION_BRIEF_DISCLOSURE_CHECKBOX =
  '- [ ] I confirm the delegation brief is fully met: all (Required) files done, verified end-to-end, acceptance criteria pass';

/**
 * Comment referencing the brief the builder received. The role that sent the
 * brief is the handback recipient, so duo names the planner and trio names the
 * specifier.
 */
function getDelegationBriefDisclosureComment(briefSourceRole: string): string {
  return `<!-- Reference the ## Goal and ## Requirements (acceptance criteria) sections from the ${briefSourceRole} handoff you received. State the delegation goal and confirm it was achieved. -->`;
}

export function getDelegationBriefDisclosureBlock(options: { briefSourceRole: string }): string {
  const { briefSourceRole } = options;
  return `${DELEGATION_BRIEF_DISCLOSURE_CHECKBOX}\n${getDelegationBriefDisclosureComment(briefSourceRole)}`;
}
