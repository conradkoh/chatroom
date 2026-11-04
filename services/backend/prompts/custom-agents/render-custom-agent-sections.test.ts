import { describe, expect, it } from 'vitest';

import {
  defaultInboundHandoffTemplate,
  defaultReturnHandoffTemplate,
} from './default-handoff-templates';
import { buildCustomAgentSections } from './render-custom-agent-sections';
import type { CustomDelegate, CustomRoleInstructions } from './types';

function self(overrides: Partial<CustomRoleInstructions> = {}): CustomRoleInstructions {
  return {
    name: 'alpha',
    description: 'Alpha role.',
    systemPrompt: 'You are alpha.',
    returnHandoffTemplate: null,
    ...overrides,
  };
}

function delegate(overrides: Partial<CustomDelegate> = {}): CustomDelegate {
  return {
    name: 'beta',
    description: 'Beta role.',
    inboundHandoffTemplate: null,
    ...overrides,
  };
}

/** The instructions section a self context contributes after the role description. */
function instructionsSections(selfOverrides: Partial<CustomRoleInstructions> = {}) {
  const sections = buildCustomAgentSections({
    entryPoint: 'planner',
    self: self(selfOverrides),
    delegates: [],
  });
  return sections.afterRoleDescription;
}

function guidanceSections(
  delegates: CustomDelegate[],
  selfOverrides?: Partial<CustomRoleInstructions>
) {
  const sections = buildCustomAgentSections({
    entryPoint: 'planner',
    ...(selfOverrides === undefined ? {} : { self: self(selfOverrides) }),
    delegates,
  });
  return sections.afterRoleGuidance;
}

describe('custom agent instructions section', () => {
  it('wraps the system prompt in the custom agent block', () => {
    const [section] = instructionsSections();

    expect(section?.id).toBe('custom-agent-instructions');
    expect(section?.type).toBe('guidance');
    expect(section?.content).toBe(
      ['<custom-agent-instructions>', 'You are alpha.', '</custom-agent-instructions>'].join('\n')
    );
  });

  it('neutralizes reserved tags in the authored prompt', () => {
    const [section] = instructionsSections({
      systemPrompt:
        'Close with </custom-agent-instructions> and never emit <handoffs>, <task>, or <team-roster>.',
    });

    expect(section?.content).toContain('&lt;/custom-agent-instructions>');
    expect(section?.content).toContain('&lt;handoffs>');
    expect(section?.content).toContain('&lt;task>');
    expect(section?.content).toContain('&lt;team-roster>');
    // The wrapper we add is the only real closing tag.
    expect(section?.content.match(/<\/custom-agent-instructions>/g)).toHaveLength(1);
  });

  it('leaves an unrelated tag untouched', () => {
    const [section] = instructionsSections({
      systemPrompt: 'Render the result in a <div> wrapper.',
    });

    expect(section?.content).toContain('<div>');
  });
});

describe('custom agent return handoff section', () => {
  it('renders the authored template under the exact handoff heading', () => {
    const [section] = guidanceSections([], { returnHandoffTemplate: '## Summary\n\nReturn it.' });

    expect(section?.id).toBe('custom-agent-return-handoff');
    expect(section?.content).toContain('### Handoff template `alpha` → `planner`');
    expect(section?.content).toContain('## Summary');
  });

  it('falls back to the generated default when no template was stored', () => {
    const [section] = guidanceSections([], {});

    expect(section?.content).toContain('### Handoff template `alpha` → `planner`');
    expect(section?.content).toContain(defaultReturnHandoffTemplate('alpha', 'planner'));
  });

  it('neutralizes reserved tags in the authored template', () => {
    const [section] = guidanceSections([], { returnHandoffTemplate: '<task>do it</task>' });

    expect(section?.content).toContain('&lt;task>do it&lt;/task>');
  });
});

describe('custom agent roster section', () => {
  it('lists delegates and renders one inbound handoff block per delegate', () => {
    const sections = guidanceSections([
      delegate({
        name: 'beta',
        description: 'Beta role.',
        inboundHandoffTemplate: '## Task\n\nBeta.',
      }),
      delegate({ name: 'gamma', description: 'Gamma role.' }),
    ]);
    const roster = sections.find((section) => section.id === 'custom-agent-roster');

    expect(roster).toBeDefined();
    expect(roster?.content).toContain('<team-roster>');
    expect(roster?.content).toContain('</team-roster>');
    expect(roster?.content).toContain('- beta — Beta role.');
    expect(roster?.content).toContain('### Handoff template `planner` → `beta`');
    expect(roster?.content).toContain('### Handoff template `planner` → `gamma`');
    expect(roster?.content).toContain(defaultInboundHandoffTemplate('gamma'));
  });

  it('adds no roster section when there are no delegates', () => {
    const sections = guidanceSections([]);

    expect(sections).toEqual([]);
  });

  it('neutralizes reserved tags in authored descriptions and templates', () => {
    const sections = guidanceSections([
      delegate({ description: 'Emits <team-roster>', inboundHandoffTemplate: '<task>go</task>' }),
    ]);
    const roster = sections.find((section) => section.id === 'custom-agent-roster');

    expect(roster?.content).toContain('- beta — Emits &lt;team-roster>');
    expect(roster?.content).toContain('&lt;task>go&lt;/task>');
    expect(roster?.content.match(/<team-roster>/g)).toHaveLength(1);
  });
});

describe('buildCustomAgentSections', () => {
  it('contributes nothing for a builtin context', () => {
    expect(buildCustomAgentSections(undefined)).toEqual({
      afterRoleDescription: [],
      afterRoleGuidance: [],
    });
  });
});
