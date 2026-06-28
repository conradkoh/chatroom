import { describe, expect, it } from 'vitest';

import { displayAgentRoleName } from './display-agent-role';

describe('displayAgentRoleName', () => {
  it('shows "default" for a single primary agent', () => {
    const agents = [{ name: 'builder', mode: 'primary' as const }];
    expect(displayAgentRoleName(agents, 'builder')).toBe('default');
  });

  it('shows the agent name when multiple roles are available', () => {
    const agents = [
      { name: 'builder', mode: 'primary' as const },
      { name: 'planner', mode: 'all' as const },
    ];
    expect(displayAgentRoleName(agents, 'builder')).toBe('builder');
    expect(displayAgentRoleName(agents, 'planner')).toBe('planner');
  });

  it('shows "default" before capabilities load (empty agent list)', () => {
    expect(displayAgentRoleName([], 'builder')).toBe('default');
  });
});
