import { AGENT_ROLE_DEFINITIONS, AgentRoleLifecycleTag } from '@workspace/shared/domain/agent-role';
import { CHATROOM_ROLE_USER } from '@workspace/shared/domain/chatroom-role';
import {
  getTeamStructure,
  TEAM_PRESETS,
  type TeamPresetId,
} from '@workspace/shared/domain/team-presets';
import { describe, expect, test } from 'vitest';

import { getHandoffTemplate, listHandoffTemplates } from './cli/handoff-templates';
import {
  validateBuiltinTeamRoleHandoffContracts,
  validateRoleHandoffContracts,
  type RoleHandoffContract,
} from './cli/handoff-templates/contracts';
import { listDuoRoleHandoffContracts } from './teams/duo/handoff-templates';
import { listSoloRoleHandoffContracts } from './teams/solo/handoff-templates';
import { BUILTIN_ROLE_TEMPLATES } from './templates';

const contractLists: Record<TeamPresetId, () => readonly RoleHandoffContract[]> = {
  duo: listDuoRoleHandoffContracts,
  solo: listSoloRoleHandoffContracts,
};

const cloneContracts = (contracts: readonly RoleHandoffContract[]): RoleHandoffContract[] =>
  contracts.map((contract) => ({
    ...contract,
    receivesFrom: [...contract.receivesFrom],
    returnsTo: [...contract.returnsTo],
    outboundTemplates: { ...contract.outboundTemplates },
  }));

describe('builtin role capability contracts', () => {
  test.each(['duo', 'solo'] as const)(
    '%s membership, prompt, and handoff catalogs agree',
    (teamId) => {
      const preset = TEAM_PRESETS[teamId];
      const structure = getTeamStructure({ teamId, persistedRoles: ['legacy'] });
      const contracts = contractLists[teamId]();
      const definitions = AGENT_ROLE_DEFINITIONS;
      const owners = contracts.map(({ role }) => role);

      expect(owners).toHaveLength(new Set(owners).size);
      expect(new Set(owners)).toEqual(new Set(preset.roles));
      expect(structure.roles.map(({ role }) => role)).toEqual(preset.roles);
      expect(structure.entryPoint).toBe(preset.entryPoint);
      expect(definitions[preset.entryPoint as keyof typeof definitions].tags[0]).toBe(
        AgentRoleLifecycleTag.Permanent
      );

      for (const role of preset.roles) {
        const definition = definitions[role as keyof typeof definitions];
        const structuralRole = structure.roles.find((entry) => entry.role === role)!;
        const template = BUILTIN_ROLE_TEMPLATES[role as keyof typeof BUILTIN_ROLE_TEMPLATES];
        const contract = contracts.find((entry) => entry.role === role)!;
        expect(role).not.toBe('user');
        expect(role).not.toBe('enhancer');
        expect(template).toBeDefined();
        expect(template.role).toBe(role);
        expect(structuralRole.lifecycle).toBe(definition.tags[0]);
        expect(structuralRole.optional).toBe(
          definition.tags[0] === AgentRoleLifecycleTag.Ephemeral
        );
        for (const target of [
          ...contract.receivesFrom,
          ...contract.returnsTo,
          ...Object.keys(contract.outboundTemplates),
        ]) {
          expect(
            target === CHATROOM_ROLE_USER || preset.roles.some((member) => member === target)
          ).toBe(true);
        }

        for (const conversationMode of ['code', 'chat'] as const) {
          const listing = listHandoffTemplates({
            teamId,
            role,
            nativeIntegration: false,
            chatroomId: 'contract-test-room',
            cliEnvPrefix: 'CHATROOM',
            conversationMode,
          });
          expect(listing).not.toBeNull();
          const resolvedListing = listing!;
          expect(resolvedListing.templates.map(({ toRole }) => toRole).sort()).toEqual(
            Object.keys(contract.outboundTemplates).sort()
          );
          expect(resolvedListing.returnsTo).toEqual(contract.returnsTo);
          expect(resolvedListing.receivesFrom).toEqual(contract.receivesFrom);
          for (const outbound of resolvedListing.templates) {
            expect(outbound.fromRole).toBe(role);
            const resolved = getHandoffTemplate({
              teamId,
              fromRole: role,
              toRole: outbound.toRole,
              role,
              chatroomId: 'contract-test-room',
              cliEnvPrefix: 'CHATROOM',
              nativeIntegration: false,
              conversationMode,
            });
            expect(resolved).toMatch(/\S/);
            expect(resolved).toBe(outbound.template);
          }
        }
      }

      expect(() => validateBuiltinTeamRoleHandoffContracts(teamId, contracts)).not.toThrow();

      for (const role of preset.roles) {
        if (
          definitions[role as keyof typeof definitions].tags[0] !== AgentRoleLifecycleTag.Ephemeral
        ) {
          continue;
        }
        expect(getHandoffTemplate({ teamId, fromRole: preset.entryPoint, toRole: role })).toMatch(
          /\S/
        );
        expect(getHandoffTemplate({ teamId, fromRole: role, toRole: preset.entryPoint })).toMatch(
          /\S/
        );
      }
    }
  );

  test.each(['duo', 'solo'] as const)(
    '%s validator rejects missing, extra, and incoherent contracts',
    (teamId) => {
      const original = contractLists[teamId]();
      const missingTriage = cloneContracts(original)
        .filter(({ role }) => role !== 'triage')
        .map((contract) => {
          const { triage: _triageGetter, ...outboundTemplates } = contract.outboundTemplates;
          return {
            ...contract,
            receivesFrom: contract.receivesFrom.filter((role) => role !== 'triage'),
            returnsTo: contract.returnsTo.filter((role) => role !== 'triage'),
            outboundTemplates,
          };
        });
      expect(() => validateRoleHandoffContracts(missingTriage)).not.toThrow();
      expect(() => validateBuiltinTeamRoleHandoffContracts(teamId, missingTriage)).toThrow(
        new RegExp(`${TEAM_PRESETS[teamId].name}.*missing.*triage`, 'i')
      );

      const reviewer: RoleHandoffContract = {
        role: 'reviewer',
        receivesFrom: [TEAM_PRESETS[teamId].entryPoint],
        returnsTo: [TEAM_PRESETS[teamId].entryPoint],
        outboundTemplates: { [TEAM_PRESETS[teamId].entryPoint]: () => 'review complete' },
      };
      const withReviewer = cloneContracts(original);
      const entryPoint = withReviewer.find(({ role }) => role === TEAM_PRESETS[teamId].entryPoint)!;
      entryPoint.receivesFrom = [...entryPoint.receivesFrom, 'reviewer'];
      entryPoint.returnsTo = [...entryPoint.returnsTo, 'reviewer'];
      entryPoint.outboundTemplates = {
        ...entryPoint.outboundTemplates,
        reviewer: () => 'review request',
      };
      withReviewer.push(reviewer);
      expect(() => validateRoleHandoffContracts(withReviewer)).not.toThrow();
      expect(() => validateBuiltinTeamRoleHandoffContracts(teamId, withReviewer)).toThrow(
        new RegExp(`${TEAM_PRESETS[teamId].name}.*unexpected.*reviewer`, 'i')
      );

      const unregisteredTarget = cloneContracts(original);
      const triage = unregisteredTarget.find(({ role }) => role === 'triage')!;
      triage.receivesFrom = [...triage.receivesFrom, 'reviewer'];
      expect(() => validateBuiltinTeamRoleHandoffContracts(teamId, unregisteredTarget)).toThrow(
        new RegExp(`${TEAM_PRESETS[teamId].name}.*triage.*reviewer`, 'i')
      );

      const unregisteredReturnTarget = cloneContracts(original);
      unregisteredReturnTarget.find(({ role }) => role === 'triage')!.returnsTo = ['reviewer'];
      expect(() =>
        validateBuiltinTeamRoleHandoffContracts(teamId, unregisteredReturnTarget)
      ).toThrow(new RegExp(`${TEAM_PRESETS[teamId].name}.*triage.*reviewer`, 'i'));

      const mismatchedReturns = cloneContracts(original);
      mismatchedReturns.find(({ role }) => role === 'triage')!.returnsTo = [];
      expect(() => validateBuiltinTeamRoleHandoffContracts(teamId, mismatchedReturns)).toThrow(
        new RegExp(`${TEAM_PRESETS[teamId].name}.*triage.*returnsTo.*outbound`, 'i')
      );

      const duplicateOwner = cloneContracts(original);
      duplicateOwner.push({ ...duplicateOwner.find(({ role }) => role === 'triage')! });
      expect(() => validateBuiltinTeamRoleHandoffContracts(teamId, duplicateOwner)).toThrow(
        new RegExp(`${TEAM_PRESETS[teamId].name}.*duplicate.*triage`, 'i')
      );

      const noncanonicalOwner = cloneContracts(original);
      noncanonicalOwner.find(({ role }) => role === 'triage')!.role = 'TRIAGE';
      expect(() => validateBuiltinTeamRoleHandoffContracts(teamId, noncanonicalOwner)).toThrow(
        new RegExp(`${TEAM_PRESETS[teamId].name}.*TRIAGE.*canonical`, 'i')
      );

      const duplicateReceivesFrom = cloneContracts(original);
      const receivesContract = duplicateReceivesFrom.find(({ role }) => role === 'triage')!;
      const existingReceiveTarget = receivesContract.receivesFrom[0];
      receivesContract.receivesFrom = [...receivesContract.receivesFrom, existingReceiveTarget];
      expect(() => validateBuiltinTeamRoleHandoffContracts(teamId, duplicateReceivesFrom)).toThrow(
        new RegExp(
          `${TEAM_PRESETS[teamId].name}.*triage.*duplicate receivesFrom.*${existingReceiveTarget}`,
          'i'
        )
      );

      const duplicateReturnsTo = cloneContracts(original);
      const returnsContract = duplicateReturnsTo.find(({ role }) => role === 'triage')!;
      const existingReturnTarget = returnsContract.returnsTo[0];
      returnsContract.returnsTo = [...returnsContract.returnsTo, existingReturnTarget];
      expect(() => validateBuiltinTeamRoleHandoffContracts(teamId, duplicateReturnsTo)).toThrow(
        new RegExp(
          `${TEAM_PRESETS[teamId].name}.*triage.*duplicate returnsTo.*${existingReturnTarget}`,
          'i'
        )
      );

      const missingGetter = cloneContracts(original);
      const getterContract = missingGetter.find(({ role }) => role === 'triage')!;
      const declaredGetterTarget = Object.keys(getterContract.outboundTemplates)[0];
      getterContract.outboundTemplates = { [declaredGetterTarget]: undefined };
      expect(() => validateBuiltinTeamRoleHandoffContracts(teamId, missingGetter)).toThrow(
        new RegExp(
          `${TEAM_PRESETS[teamId].name}.*triage.*no outbound getter.*${declaredGetterTarget}`,
          'i'
        )
      );

      const missingReverseOutbound = cloneContracts(original);
      const entryPointContract = missingReverseOutbound.find(
        ({ role }) => role === TEAM_PRESETS[teamId].entryPoint
      )!;
      const { triage: _triageGetter, ...entryPointOutbound } = entryPointContract.outboundTemplates;
      entryPointContract.outboundTemplates = entryPointOutbound;
      entryPointContract.returnsTo = entryPointContract.returnsTo.filter(
        (role) => role !== 'triage'
      );
      expect(() => validateBuiltinTeamRoleHandoffContracts(teamId, missingReverseOutbound)).toThrow(
        new RegExp(
          `${TEAM_PRESETS[teamId].name}.*triage.*receives from "${TEAM_PRESETS[teamId].entryPoint}".*reverse outbound`,
          'i'
        )
      );

      const brokenReciprocity = cloneContracts(original);
      const advisoryRole = brokenReciprocity.find(({ role }) => role === 'triage')!;
      advisoryRole.receivesFrom = [];
      expect(() => validateBuiltinTeamRoleHandoffContracts(teamId, brokenReciprocity)).toThrow(
        new RegExp(`${TEAM_PRESETS[teamId].name}.*reciprocity.*triage`, 'i')
      );
    }
  );
});
