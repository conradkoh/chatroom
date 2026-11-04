import { describe, expect, it } from 'vitest';

import { listSkills } from './list-skills';

function ids(teamId: string | undefined): string[] {
  return listSkills(teamId).map((skill) => skill.skillId);
}

describe('listSkills', () => {
  it('lists the custom-agents skill for a duo team', () => {
    expect(ids('duo')).toContain('custom-agents');
  });

  it('omits the custom-agents skill for a solo team', () => {
    // Custom agents merge only on duo teams, so the glossary hides the skill
    // there and the list must agree.
    expect(ids('solo')).not.toContain('custom-agents');
  });

  it('keeps every other built-in skill for every team', () => {
    expect(ids('solo')).toContain('backlog');
    expect(ids('solo')).toContain('code-review');
  });
});
