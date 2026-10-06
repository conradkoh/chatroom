import { describe, expect, test } from 'vitest';

import { generateFullCliOutput } from '../../../prompts/cli/get-next-task/fullOutput';
import { getHandoffTemplate } from '../../../prompts/cli/handoff-templates';
import { getBuilderGuidance } from '../../../prompts/cli/roles/builder';
import { getPlannerGuidance } from '../../../prompts/cli/roles/planner';
import { getUiuxEngineerGuidance } from '../../../prompts/cli/roles/uiux-engineer';
import { generateNativeTaskDeliveryOutput } from '../../../prompts/native/task-delivery';
import { getSoloGuidance } from '../../../prompts/teams/solo/prompts/solo';
import { getUiuxEngineerToEntryPointHandoffTemplate } from '../../../prompts/teams/uiux-engineer-handoff-templates';

const snapshot =
  "first write a snapshot test that renders the component with the UI/UX engineer's target markup, classes, and styles as the expected output. Run it and confirm it fails, then implement the components until it passes. Do not update the expected snapshot to accept different markup.";

function delivery(role: string, teamId: 'duo' | 'solo', nativeIntegration: boolean): string {
  const targets =
    teamId === 'duo'
      ? ['uiux-engineer', 'builder', 'planner', 'user']
      : ['uiux-engineer', 'solo', 'user'];
  const params = {
    chatroomId: 'room-id',
    role,
    cliEnvPrefix: '',
    teamId,
    task: { _id: 'task-id', content: 'Implement the requested UI.' },
    message: null,
    isEntryPoint: role === 'planner' || role === 'solo',
    availableHandoffTargets:
      role === 'uiux-engineer' ? [teamId === 'solo' ? 'solo' : 'planner'] : targets,
  } as const;
  return nativeIntegration
    ? generateNativeTaskDeliveryOutput(params)
    : generateFullCliOutput({ ...params, nativeIntegration: false });
}

describe('UI/UX ownership and snapshot-first implementation', () => {
  test('Duo and Solo planner guidance routes UI/UX ownership in native and CLI modes', () => {
    for (const [teamId, teamRoles] of [
      ['duo', ['planner', 'builder']],
      ['solo', ['solo']],
    ] as const)
      for (const nativeIntegration of [false, true]) {
        const guidance = getPlannerGuidance({
          role: 'planner',
          teamRoles,
          isEntryPoint: true,
          convexUrl: 'http://127.0.0.1:3210',
          nativeIntegration,
        });
        expect(guidance).toContain('The UI/UX engineer owns the design.');
        expect(guidance).toContain(
          'Request its markup, classes, and styles for the implementation brief.'
        );
        if (teamId === 'duo')
          expect(guidance).toContain(
            'You own architecture and API shape; the UI/UX engineer owns UI/UX design.'
          );
      }
  });

  test('engineer guidance and Duo/Solo handbacks include target markup, classes, and styles', () => {
    expect(getUiuxEngineerGuidance()).toContain(
      'Provide the target markup, classes, and styles in your handoff.'
    );
    for (const role of ['planner', 'solo'] as const)
      expect(getUiuxEngineerToEntryPointHandoffTemplate(role)).toContain(
        'Provide the target HTML markup with exact class attributes and any required CSS/styles in the handoff.'
      );
    expect(getHandoffTemplate({ fromRole: 'uiux-engineer', toRole: 'planner' })).toContain(
      'Target HTML markup, exact class attributes, and required CSS/styles.'
    );
  });

  test('builder and Solo require a failing rendered snapshot before implementation', () => {
    for (const nativeIntegration of [false, true]) {
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
      for (const guidance of [builder, solo]) expect(guidance).toContain(snapshot);
      expect(solo).toContain(
        'owns the UI/UX decisions and provides the target markup, classes, and styles'
      );
    }
  });

  test('Duo planner and Duo/Solo engineer deliveries retain their UI/UX handoff contracts', () => {
    for (const [teamId, role] of [
      ['duo', 'planner'],
      ['duo', 'uiux-engineer'],
      ['solo', 'uiux-engineer'],
    ] as const)
      for (const nativeIntegration of [false, true]) {
        const output = delivery(role, teamId, nativeIntegration);
        if (role === 'planner') {
          expect(output).toContain('The UI/UX engineer owns UI/UX design.');
          expect(output).toContain(
            'Include its target markup, classes, and styles in UI implementation briefs'
          );
        } else {
          expect(output).toContain(
            'Provide the target HTML markup with exact class attributes and any required CSS/styles in the handoff.'
          );
        }
      }
  });
});
