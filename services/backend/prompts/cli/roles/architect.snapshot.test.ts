import { describe, expect, test } from 'vitest';

import { getArchitectGuidance } from './architect';

describe('architect guidance snapshots', () => {
  test.each([
    ['CLI planner', { nativeIntegration: false, recipientRole: 'planner' }],
    ['native planner', { nativeIntegration: true, recipientRole: 'planner' }],
    ['CLI solo', { nativeIntegration: false, recipientRole: 'solo' }],
    ['native solo', { nativeIntegration: true, recipientRole: 'solo' }],
  ] as const)('%s renders the complete operating model', (_variant, params) => {
    const guidance = getArchitectGuidance(params);

    expect(guidance).toMatchSnapshot();
  });

  test('decides technical decisions itself and escalates only by criteria', () => {
    const guidance = getArchitectGuidance({ nativeIntegration: false, recipientRole: 'planner' });

    expect(guidance).toContain('Decide every open technical decision');
    expect(guidance).toContain('(approach, design, contracts, schema, libraries, trade-offs)');
    expect(guidance).toContain('Do not hand `planner` a list of open technical questions');
    expect(guidance).toContain('open technical decision for the development work yourself');
    expect(guidance).toContain('Questions outside repository technical design');
    expect(guidance).not.toContain('Never hand');
    expect(guidance).not.toMatch(/never hand[^.]*list/i);
    expect(guidance).toContain('(a) **ambiguous or insufficient request:**');
    expect(guidance).toContain('(b) **destructive risk:**');
    expect(guidance).toContain('## Escalation items for the user');
    expect(guidance).toContain('exactly one recommended, evidence-backed design'); // still one design
    expect(guidance).not.toContain('{ENTRY_POINT_ROLE}');
  });
});
