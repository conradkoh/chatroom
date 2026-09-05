/**
 * Resolver compatibility + contract reciprocity tests for the role-owned
 * handoff template catalogs.
 */

import { describe, expect, test } from 'vitest';

import { validateRoleHandoffContracts } from './contracts';
import type { RoleHandoffContract } from './contracts';
import { getHandoffTemplate, type HandoffTemplateQuery } from './index';
import { getBuilderToPlannerHandoffTemplate } from '../../teams/duo/handoff-templates/builder-to-planner';
import { getEnhancerToPlannerHandoffTemplate } from '../../teams/duo/handoff-templates/enhancer-to-planner';
import { getPlannerToBuilderHandoffTemplate } from '../../teams/duo/handoff-templates/planner-to-builder';
import { getPlannerToEnhancerHandoffTemplate } from '../../teams/duo/handoff-templates/planner-to-enhancer';
import { getPlannerToUserReportTemplate } from '../../teams/duo/handoff-templates/planner-to-user';
import { getSoloToUserReportTemplate } from '../../teams/solo/handoff-templates/solo-to-user';

const duoQuery = (fromRole: string, toRole: string): HandoffTemplateQuery => ({
  teamId: 'duo',
  fromRole,
  toRole,
});

describe('getHandoffTemplate — historic pair compatibility', () => {
  test('resolves every historical renderable duo pair to its exact prose', () => {
    expect(getHandoffTemplate(duoQuery('planner', 'builder'))).toBe(
      getPlannerToBuilderHandoffTemplate()
    );
    expect(getHandoffTemplate(duoQuery('planner', 'enhancer'))).toBe(
      getPlannerToEnhancerHandoffTemplate()
    );
    expect(getHandoffTemplate(duoQuery('enhancer', 'planner'))).toBe(
      getEnhancerToPlannerHandoffTemplate()
    );
    expect(getHandoffTemplate(duoQuery('builder', 'planner'))).toBe(
      getBuilderToPlannerHandoffTemplate()
    );
    expect(getHandoffTemplate(duoQuery('planner', 'user'))).toBe(getPlannerToUserReportTemplate());
  });

  test('resolves every historical renderable solo pair', () => {
    expect(getHandoffTemplate({ teamId: 'solo', fromRole: 'solo', toRole: 'user' })).toBe(
      getSoloToUserReportTemplate()
    );
    expect(getHandoffTemplate({ teamId: 'solo', fromRole: 'solo', toRole: 'enhancer' })).toContain(
      'Planning Request (Solo → Enhancer)'
    );
    expect(getHandoffTemplate({ teamId: 'solo', fromRole: 'enhancer', toRole: 'solo' })).toContain(
      'Design Input (Enhancer → Solo)'
    );
  });

  test('role names are case-insensitive for fromRole and toRole', () => {
    expect(getHandoffTemplate(duoQuery('Planner', 'BUILDER'))).toBe(
      getPlannerToBuilderHandoffTemplate()
    );
    expect(getHandoffTemplate(duoQuery('planner', 'USER'))).toBe(getPlannerToUserReportTemplate());
  });

  test('unknown pairs remain null', () => {
    expect(getHandoffTemplate(duoQuery('builder', 'user'))).toBeNull();
    expect(getHandoffTemplate(duoQuery('planner', 'reviewer'))).toBeNull();
    expect(getHandoffTemplate(duoQuery('solo', 'builder'))).toBeNull();
    expect(getHandoffTemplate({ teamId: 'tri', fromRole: 'planner', toRole: 'user' })).toBeNull();
  });
});

describe('validateRoleHandoffContracts', () => {
  test('accepts a valid reciprocal duo-style catalog', () => {
    const contracts: readonly RoleHandoffContract[] = [
      {
        role: 'planner',
        receivesFrom: ['user', 'builder'],
        returnsTo: ['builder', 'user'],
        outboundTemplates: { builder: () => 'b', user: () => 'u' },
      },
      {
        role: 'builder',
        receivesFrom: ['planner'],
        returnsTo: ['planner'],
        outboundTemplates: { planner: () => 'p' },
      },
    ];
    expect(() => validateRoleHandoffContracts(contracts)).not.toThrow();
  });

  test('rejects an outbound target that is neither user nor a catalog role', () => {
    const contracts: readonly RoleHandoffContract[] = [
      {
        role: 'planner',
        receivesFrom: [],
        returnsTo: ['builder'],
        outboundTemplates: { builder: () => 'b' },
      },
    ];
    expect(() => validateRoleHandoffContracts(contracts)).toThrow(
      /neither 'user' nor a role listed in the catalogue/i
    );
  });

  test('rejects a missing reciprocal receivesFrom declaration with a descriptive message', () => {
    const contracts: readonly RoleHandoffContract[] = [
      {
        role: 'planner',
        receivesFrom: [],
        returnsTo: ['builder', 'user'],
        outboundTemplates: { builder: () => 'b', user: () => 'u' },
      },
      {
        role: 'builder',
        receivesFrom: [], // missing reciprocal declaration for planner
        returnsTo: ['planner'],
        outboundTemplates: { planner: () => 'p' },
      },
    ];
    expect(() => validateRoleHandoffContracts(contracts)).toThrow(/Reciprocity failure/i);
    expect(() => validateRoleHandoffContracts(contracts)).toThrow(/does not declare "planner"/i);
  });

  test('rejects duplicate role contracts', () => {
    const duplicate: readonly RoleHandoffContract[] = [
      {
        role: 'planner',
        receivesFrom: [],
        returnsTo: ['user'],
        outboundTemplates: { user: () => 'u' },
      },
      {
        role: 'Planner',
        receivesFrom: [],
        returnsTo: ['user'],
        outboundTemplates: { user: () => 'u' },
      },
    ];
    expect(() => validateRoleHandoffContracts(duplicate)).toThrow(
      /Duplicate role handoff contract/i
    );
  });
});
