import { describe, expect, it } from 'vitest';
import { shouldIncludeGeneralKnowledge } from './agent-general-knowledge';
describe('general knowledge role config', () => {
  it.each(['planner', 'builder', 'solo', 'enhancer'])('includes knowledge for %s', (role) =>
    expect(shouldIncludeGeneralKnowledge(role)).toBe(true)
  );
  it('defaults unknown roles to enabled', () =>
    expect(shouldIncludeGeneralKnowledge('unknown')).toBe(true));
});
