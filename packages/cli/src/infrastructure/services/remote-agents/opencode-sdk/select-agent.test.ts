import { describe, it, expect } from 'vitest';
import type { Agent } from '@opencode-ai/sdk';
import { selectAgent } from './select-agent';

const createAgent = (name: string, mode: 'subagent' | 'primary' | 'all'): Agent => ({
  name,
  mode,
  builtIn: false,
  permission: { edit: 'allow', bash: {} },
  tools: {},
  options: {},
});

describe('selectAgent', () => {
  it('returns the build agent when present among primaries', () => {
    const agents = [createAgent('planner', 'primary'), createAgent('build', 'primary')];
    const result = selectAgent(agents);
    expect(result.name).toBe('build');
  });

  it('returns the first primary when build is absent', () => {
    const agents = [createAgent('planner', 'primary'), createAgent('other', 'primary')];
    const result = selectAgent(agents);
    expect(result.name).toBe('planner');
  });

  it('filters out mode === subagent entries even if named build', () => {
    const agents = [createAgent('build', 'subagent'), createAgent('planner', 'primary')];
    const result = selectAgent(agents);
    expect(result.name).toBe('planner');
  });

  it('throws when the list is empty', () => {
    expect(() => selectAgent([])).toThrow(
      'No usable opencode agent available (server returned 0 non-subagent agents)'
    );
  });

  it('throws when the list contains only subagents', () => {
    const agents = [createAgent('build', 'subagent'), createAgent('helper', 'subagent')];
    expect(() => selectAgent(agents)).toThrow(
      'No usable opencode agent available (server returned 0 non-subagent agents)'
    );
  });
});
