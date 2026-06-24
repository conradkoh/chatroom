import { describe, expect, test } from 'vitest';

import { getTeamCompositionSection } from '../../../prompts/cli/sections/team-composition';

describe('getTeamCompositionSection', () => {
  test('duo team describes roles without implying online status', () => {
    const section = getTeamCompositionSection(['planner', 'builder']);

    expect(section).toContain('**Team composition:** Duo team');
    expect(section).toContain('`builder`');
    expect(section).toContain('**Agent presence:**');
    expect(section).not.toMatch(/\bavailable\b/i);
    expect(section).not.toContain('**Team Availability:**');
  });

  test('solo role team is described as solo composition', () => {
    const section = getTeamCompositionSection(['solo']);

    expect(section).toContain('**Team composition:** Solo team');
    expect(section).not.toContain('Duo team');
  });

  test('planner-only team roles fall back to solo composition', () => {
    const section = getTeamCompositionSection(['planner']);

    expect(section).toContain('**Team composition:** Solo team');
  });
});
