import { describe, expect, it } from 'vitest';

import { getGlossarySection } from './glossary';

/** The rendered glossary section for one team. */
function glossaryFor(teamId: string | undefined, compactSkills = false): string {
  return getGlossarySection({ convexUrl: '', teamId, compactSkills }).content;
}

describe('glossary skill list', () => {
  it('lists the custom-agents skill for a duo team', () => {
    expect(glossaryFor('duo')).toContain('**custom-agents**');
  });

  it('omits the custom-agents skill for a solo team', () => {
    // Custom agents are duo-only, so a solo prompt must not advertise the skill.
    expect(glossaryFor('solo')).not.toContain('**custom-agents**');
  });

  it('omits the custom-agents skill for a legacy team id', () => {
    expect(glossaryFor('legacy')).not.toContain('**custom-agents**');
  });

  it('keeps the other skills for every team', () => {
    expect(glossaryFor('solo')).toContain('**backlog**');
    expect(glossaryFor('legacy')).toContain('**code-review**');
  });
});
