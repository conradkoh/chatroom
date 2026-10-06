import { describe, expect, test } from 'vitest';

import { generateFullCliOutput } from '../../../prompts/cli/get-next-task/fullOutput';
import { viewHandoffTemplate } from '../../../prompts/cli/handoff/view-template';
import { getHandoffTemplate } from '../../../prompts/cli/handoff-templates';
import { getBuilderGuidance } from '../../../prompts/cli/roles/builder';
import { getPlannerGuidance } from '../../../prompts/cli/roles/planner';
import { getUiuxEngineerGuidance } from '../../../prompts/cli/roles/uiux-engineer';
import { generateNativeTaskDeliveryOutput } from '../../../prompts/native/task-delivery';
import { getSoloGuidance } from '../../../prompts/teams/solo/prompts/solo';
import { getUiuxEngineerToEntryPointHandoffTemplate } from '../../../prompts/teams/uiux-engineer-handoff-templates';

const DESIGN_HEADINGS = [
  '## Existing UI evidence',
  '## Rendered target markup',
  '## UI tests first',
];

function expectOrdered(text: string, pieces: string[]): void {
  let cursor = -1;
  for (const piece of pieces) {
    const next = text.toLowerCase().indexOf(piece.toLowerCase(), cursor + 1);
    expect(next, `expected "${piece}" after position ${cursor}`).toBeGreaterThan(cursor);
    cursor = next;
  }
}

function delivery(
  role: string,
  teamId: 'duo' | 'solo',
  nativeIntegration: boolean,
  conversationMode?: 'chat' | 'code' | 'code:enhanced'
): string {
  const common = {
    chatroomId: 'room-id',
    role,
    cliEnvPrefix: '',
    teamId,
    task: { _id: 'task-id', content: 'Fix the UI problem' },
    message: {
      _id: 'message-id',
      senderRole:
        role === 'builder' || role === 'uiux-engineer'
          ? teamId === 'solo'
            ? 'solo'
            : 'planner'
          : 'user',
      content: '',
    },
    isEntryPoint: role === 'planner' || role === 'solo',
    conversationMode,
    availableHandoffTargets:
      role === 'uiux-engineer'
        ? teamId === 'solo'
          ? ['solo']
          : ['planner']
        : teamId === 'duo'
          ? ['uiux-engineer', 'builder', 'planner', 'user']
          : ['uiux-engineer', 'solo', 'user'],
  } as const;

  return nativeIntegration
    ? generateNativeTaskDeliveryOutput(common)
    : generateFullCliOutput({ ...common, nativeIntegration: false });
}

describe('UI/UX-directed implementation contract', () => {
  test('UI/UX engineer studies source and rendered UI, then returns one rendered target and test contract', () => {
    const guidance = getUiuxEngineerGuidance({
      entryPointRole: 'planner',
      nativeIntegration: true,
    });

    expect(guidance).toContain('Study existing source markup, rendered DOM, applied styles');
    expect(guidance).toContain('then render it in a browser');
    expect(guidance).toContain(
      'Temporary design preview artifacts outside the tracked repository are permitted'
    );
    expect(guidance).toContain('do not change tracked source or implement production UI');
    expect(guidance).toContain(
      'Missing rendering evidence or unresolved design choices are blockers'
    );
    expect(guidance).toContain('--next-role="planner"');
    expect(guidance).not.toContain('optional design');
  });

  test.each(['planner', 'solo'] as const)(
    '%s engineer handback requires rendered markup and tests-first evidence',
    (entryPoint) => {
      const template = getUiuxEngineerToEntryPointHandoffTemplate(entryPoint);
      for (const heading of DESIGN_HEADINGS) expect(template).toContain(heading);
      expect(template).toContain('complete target HTML with class attributes');
      expect(template).toContain('actual browser screenshot or DOM/computed-style evidence');
      expect(template).toContain('expected meaningful initial failure');
      expect(template).toContain('never test only a mock of the proposal');
      expect(template).toContain('compare production DOM and styles with the rendered target');
      expect(template).toContain('The UI/UX engineer defines interface structure');
      expect(template).toContain('Provide design or test revisions through the entry point');
      expect(template).not.toContain('## Design authority and implementation sequence');
      expect(template).not.toContain('unchanged');
      expect(template).toContain(
        'Do not propose or require web accessibility implementation work unless the user explicitly requests it'
      );
    }
  );

  test('generic engineer handback keeps its configured entry point neutral', () => {
    const generic = viewHandoffTemplate({ role: 'uiux-engineer' });
    expect(generic).toContain('<entry-point-role>');
    expect(generic).not.toMatch(/planner|solo/);
  });

  test('affected role contracts state UI ownership and evidence without historical shorthand', () => {
    const planner = getPlannerGuidance({
      role: 'planner',
      teamRoles: ['planner', 'builder'],
      isEntryPoint: true,
      convexUrl: 'http://127.0.0.1:3210',
    });
    const solo = getPlannerGuidance({
      role: 'planner',
      teamRoles: ['solo'],
      isEntryPoint: true,
      convexUrl: 'http://127.0.0.1:3210',
    });
    const engineer = getUiuxEngineerToEntryPointHandoffTemplate('planner');
    const builderBrief = getHandoffTemplate({ fromRole: 'planner', toRole: 'builder' }) ?? '';

    for (const prompt of [planner, solo, engineer, builderBrief]) {
      expect(prompt).not.toMatch(
        /unchanged|normal loop|normal solo path|existing handoff contract|Preserve it|Design ≠ completion/
      );
    }
    expect(engineer).toContain(
      'The configured entry point owns architecture, data, and API decisions'
    );
    expect(engineer).toContain(
      'the UI/UX engineer owns UI structure, styles, states, interactions, and UI tests'
    );
  });

  test.each([
    ['duo', 'planner', false],
    ['duo', 'planner', true],
    ['solo', 'solo', false],
    ['solo', 'solo', true],
  ] as const)(
    '%s %s task delivery includes design and implementation gates (native=%s)',
    (teamId, role, nativeIntegration) => {
      const output = delivery(role, teamId, nativeIntegration);
      expect(output).toMatch(/state the observed UI problem/i);
      expect(output).toMatch(/inspect the existing source markup and rendered DOM\/styles/i);
      expect(output).toMatch(/browser-render one concrete target/i);
      if (teamId === 'duo') {
        expect(output).toContain('## UI/UX design contract');
        expect(output).toContain('complete UI/UX engineer handback verbatim');
        expect(output).toContain(
          'Return missing evidence to the planner before production UI edits'
        );
      }
    }
  );

  test.each(['chat', 'code'] as const)(
    '%s mode keeps engineer and implementer contracts in assembled delivery',
    (conversationMode) => {
      const output = delivery('planner', 'duo', false, conversationMode);
      expect(output).toContain('## UI/UX design contract');
      expect(output).toContain('## Handoff Template (planner → uiux-engineer)');
      if (conversationMode === 'chat') expect(output).toContain('<chat-mode>');
      else expect(output).not.toContain('<chat-mode>');
    }
  );

  test.each([false, true])(
    'engineer task delivery renders the complete returned contract (native=%s)',
    (nativeIntegration) => {
      for (const teamId of ['duo', 'solo'] as const) {
        const output = delivery('uiux-engineer', teamId, nativeIntegration);
        for (const heading of DESIGN_HEADINGS) expect(output).toContain(heading);
        expect(output).toContain('actual browser screenshot or DOM/computed-style evidence');
        expect(output).toContain('expected meaningful initial failure');
      }
    }
  );

  test.each([false, true])(
    'planner coordinator prompt preserves UI ownership and engineer-first path (native=%s)',
    (nativeIntegration) => {
      const guidance = getPlannerGuidance({
        role: 'planner',
        teamRoles: ['planner', 'builder'],
        isEntryPoint: true,
        convexUrl: 'http://127.0.0.1:3210',
        nativeIntegration,
      });
      expect(guidance).toContain(
        'Define architecture, data, and API contracts in the brief. The UI/UX engineer defines UI design and tests; the builder runs the specified UI tests before production UI edits.'
      );
      expect(guidance).toContain(
        'Describe the problem, desired outcome, affected surfaces, constraints, and evidence to the UI/UX engineer before builder implementation.'
      );
      expect(guidance).toContain('Include the engineer’s complete browser-rendered design');
      expectOrdered(guidance, [
        'For UI fixes or interface design, the UI/UX engineer supplies a browser-rendered design',
        'C{UI work?}',
        'U[Request UI/UX engineer design]',
        'V[Review rendered design and UI tests]',
        'F[Delegate ONE phase to builder]',
      ]);
      expect(guidance).toContain('C -->|No| F');
      expect(guidance).not.toContain('UI/UX if needed');
      expect(guidance).toContain('A design handback authorizes implementation.');
      expect(guidance).toContain('User delivery requires completed implementation, passing tests');
      expect(guidance).not.toMatch(/unchanged|normal loop|Design ≠ completion|gaps\/changes/);
    }
  );

  test.each([false, true])(
    'solo planner implementation guidance uses solo tests-first language without builder delegation (native=%s)',
    (nativeIntegration) => {
      const guidance = getPlannerGuidance({
        role: 'planner',
        teamRoles: ['solo'],
        isEntryPoint: true,
        convexUrl: 'http://127.0.0.1:3210',
        nativeIntegration,
      });

      expect(guidance).toContain('Write and run those tests before production UI edits');
      expect(guidance).toContain('request missing evidence or design revisions from the engineer');
      expect(guidance).not.toMatch(/builder tests first|delegate.{0,30}builder/i);
    }
  );

  test.each([false, true])(
    'builder and solo implementation prompts require design evidence and meaningful red before production edits (native=%s)',
    (nativeIntegration) => {
      const builder = getBuilderGuidance({
        role: 'builder',
        teamRoles: ['planner', 'builder'],
        isEntryPoint: false,
        convexUrl: 'http://127.0.0.1:3210',
        nativeIntegration,
      });
      const solo = getSoloGuidance({
        role: 'solo',
        teamRoles: ['solo'],
        isEntryPoint: true,
        convexUrl: 'http://127.0.0.1:3210',
        nativeIntegration,
      });

      for (const guidance of [builder, solo]) {
        expectOrdered(guidance, [
          'before production edits',
          'meaningful design-relevant failure',
          'implement',
          'compare production DOM and styles with the rendered target',
        ]);
        expect(guidance).toMatch(
          /production UI tests before production (?:UI )?edits|those tests to a meaningful failure before production UI edits/i
        );
        expect(guidance).toMatch(/meaningful (?:design-relevant )?(?:initial )?(?:failure|red)/i);
        expect(guidance).toMatch(/rerun.{0,30}pass/i);
        expect(guidance).toMatch(/compare production DOM and styles with the rendered target/i);
        expect(guidance).toMatch(/weaken.*tests/i);
        expect(guidance).toMatch(
          /return a concrete blocker|missing evidence.*blockers|report missing evidence/i
        );
      }
    }
  );

  test('engineer design handoff is wired and retains supported role handoffs', () => {
    expect(getHandoffTemplate({ fromRole: 'planner', toRole: 'uiux-engineer' })).toMatch(
      /state the observed UI problem/i
    );
    expect(getHandoffTemplate({ fromRole: 'uiux-engineer', toRole: 'planner' })).toContain(
      '## Rendered target markup'
    );
    expect(getHandoffTemplate({ fromRole: 'uiux-engineer', toRole: 'builder' })).toBeNull();
    expect(getHandoffTemplate({ fromRole: 'planner', toRole: 'builder' })).toContain(
      '## UI/UX design contract'
    );
    expect(getHandoffTemplate({ fromRole: 'planner', toRole: 'architect' })).toContain(
      'Handoff Template (planner → architect)'
    );
    expect(getHandoffTemplate({ fromRole: 'architect', toRole: 'planner' })).toContain(
      'implementation sequence'
    );
  });
});
