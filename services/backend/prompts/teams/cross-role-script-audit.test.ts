import { describe, expect, test } from 'vitest';

import {
  auditCrossRoleScript,
  collectCrossRoleAuditInput,
  RECIPIENT_CONTEXT_EXPECTATIONS,
  type CrossRoleAuditInput,
  type CrossRoleViolationKind,
  type RenderedHandoffTemplate,
} from './cross-role-script-audit';
import {
  GROUNDING_REFERENCE_HEADING,
  type GroundingReferencePair,
} from '../cli/grounding/reference';

/**
 * Independent spec: every entry-point delegation to a non-user recipient, plus
 * trio `specifier` → `builder`. Hard-coded from the role-handoff contract and
 * deliberately not derived from `pairCarriesGroundingReference`, so a wrong
 * production predicate fails here.
 */
const GROUNDING_REFERENCE_PAIRS: readonly GroundingReferencePair[] = [
  // duo: planner is the entry point.
  { teamId: 'duo', fromRole: 'planner', toRole: 'builder' },
  { teamId: 'duo', fromRole: 'planner', toRole: 'architect' },
  { teamId: 'duo', fromRole: 'planner', toRole: 'prompt-engineer' },
  { teamId: 'duo', fromRole: 'planner', toRole: 'product-manager' },
  { teamId: 'duo', fromRole: 'planner', toRole: 'uiux-engineer' },
  { teamId: 'duo', fromRole: 'planner', toRole: 'triage' },
  { teamId: 'duo', fromRole: 'planner', toRole: 'researcher' },
  { teamId: 'duo', fromRole: 'planner', toRole: 'reviewer' },
  { teamId: 'duo', fromRole: 'planner', toRole: 'game-asset-designer' },
  { teamId: 'duo', fromRole: 'planner', toRole: 'verifier' },
  // solo: solo is the entry point.
  { teamId: 'solo', fromRole: 'solo', toRole: 'architect' },
  { teamId: 'solo', fromRole: 'solo', toRole: 'prompt-engineer' },
  { teamId: 'solo', fromRole: 'solo', toRole: 'product-manager' },
  { teamId: 'solo', fromRole: 'solo', toRole: 'uiux-engineer' },
  { teamId: 'solo', fromRole: 'solo', toRole: 'triage' },
  { teamId: 'solo', fromRole: 'solo', toRole: 'verifier' },
  // trio: coordinator is the entry point; specifier → builder is the extra edge.
  { teamId: 'trio', fromRole: 'coordinator', toRole: 'specifier' },
  { teamId: 'trio', fromRole: 'coordinator', toRole: 'architect' },
  { teamId: 'trio', fromRole: 'coordinator', toRole: 'prompt-engineer' },
  { teamId: 'trio', fromRole: 'coordinator', toRole: 'product-manager' },
  { teamId: 'trio', fromRole: 'coordinator', toRole: 'uiux-engineer' },
  { teamId: 'trio', fromRole: 'coordinator', toRole: 'triage' },
  { teamId: 'trio', fromRole: 'coordinator', toRole: 'researcher' },
  { teamId: 'trio', fromRole: 'coordinator', toRole: 'reviewer' },
  { teamId: 'trio', fromRole: 'coordinator', toRole: 'game-asset-designer' },
  { teamId: 'trio', fromRole: 'coordinator', toRole: 'verifier' },
  { teamId: 'trio', fromRole: 'specifier', toRole: 'builder' },
];

function collectedInput(): CrossRoleAuditInput {
  return { ...collectCrossRoleAuditInput(), groundingReferencePairs: GROUNDING_REFERENCE_PAIRS };
}

function withTemplate(
  input: CrossRoleAuditInput,
  matches: (template: RenderedHandoffTemplate) => boolean,
  mutate: (template: RenderedHandoffTemplate) => RenderedHandoffTemplate
): CrossRoleAuditInput {
  return {
    ...input,
    templates: input.templates.map((template) => (matches(template) ? mutate(template) : template)),
  };
}

function violationFor(input: CrossRoleAuditInput, pair: string, kind: CrossRoleViolationKind) {
  return auditCrossRoleScript(input).find(
    (violation) => violation.pair === pair && violation.kind === kind
  );
}

describe('cross-role script audit', () => {
  test('every preset team role prompt and handoff template honours the cross-role script', () => {
    expect(auditCrossRoleScript(collectedInput())).toEqual([]);
  });

  test('audits every preset team', () => {
    const input = collectedInput();
    expect([...new Set(input.rolePrompts.map((prompt) => prompt.teamId))].sort()).toEqual([
      'duo',
      'solo',
      'trio',
    ]);
    expect([...new Set(input.templates.map((template) => template.teamId))].sort()).toEqual([
      'duo',
      'solo',
      'trio',
    ]);
  });

  test('declares a context expectation for every recipient role', () => {
    const input = collectedInput();
    const recipients = new Set(
      input.templates.map((template) => template.toRole).filter((role) => role !== 'user')
    );
    expect([...recipients].filter((role) => !(role in input.recipientExpectations))).toEqual([]);
  });

  test('no recipient expectation passes on a Summary section alone', () => {
    for (const [role, expectation] of Object.entries(RECIPIENT_CONTEXT_EXPECTATIONS)) {
      for (const [sender, tokens] of Object.entries(expectation.requiredBySender)) {
        expect(tokens.length, `${role} ← ${sender}`).toBeGreaterThan(1);
        expect(
          tokens.some((token) => token !== '## Summary'),
          `${role} ← ${sender}`
        ).toBe(true);
      }
    }
  });

  test('names the mismatched pair when a prompt advertises an undeclared target', () => {
    const input = collectedInput();
    const mutated: CrossRoleAuditInput = {
      ...input,
      rolePrompts: input.rolePrompts.map((prompt) =>
        prompt.teamId === 'trio' && prompt.role === 'builder'
          ? { ...prompt, advertisedTargets: [...prompt.advertisedTargets, 'researcher'] }
          : prompt
      ),
    };

    const violation = violationFor(mutated, 'trio: builder → researcher', 'undeclared-target');
    expect(violation).toBeDefined();
    expect(violation?.message).toContain('trio: builder → researcher');
  });

  test('names the pair when an advisory prompt advertises a target that is not runtime-available', () => {
    const input = collectedInput();
    const mutated: CrossRoleAuditInput = {
      ...input,
      rolePrompts: input.rolePrompts.map((prompt) =>
        prompt.teamId === 'solo' && prompt.role === 'solo'
          ? { ...prompt, advertisedTargets: ['solo', ...prompt.advertisedTargets] }
          : prompt
      ),
    };

    const violation = violationFor(mutated, 'solo: solo → solo', 'undeclared-target');
    expect(violation).toBeDefined();
    expect(violation?.message).toContain('solo: solo → solo');
  });

  test('names the pair when a prompt omits a runtime-available target', () => {
    const input = collectedInput();
    const mutated: CrossRoleAuditInput = {
      ...input,
      rolePrompts: input.rolePrompts.map((prompt) =>
        prompt.teamId === 'duo' && prompt.role === 'planner'
          ? {
              ...prompt,
              advertisedTargets: prompt.advertisedTargets.filter((target) => target !== 'user'),
            }
          : prompt
      ),
    };

    const violation = violationFor(mutated, 'duo: planner → user', 'unadvertised-target');
    expect(violation).toBeDefined();
    expect(violation?.message).toContain('duo: planner → user');
  });

  test('names the mismatched pair when the delegator omits context the recipient expects', () => {
    const input = collectedInput();
    const mutated = withTemplate(
      input,
      (template) =>
        template.teamId === 'trio' &&
        template.fromRole === 'specifier' &&
        template.toRole === 'builder' &&
        template.mode === 'code',
      (template) => ({
        ...template,
        text: template.text.replaceAll('## Verification flags', '## Verification notes'),
      })
    );

    const violation = violationFor(mutated, 'trio: specifier → builder', 'missing-context');
    expect(violation).toBeDefined();
    expect(violation?.message).toContain('trio: specifier → builder');
  });

  test('names the mismatched pair when a template sends work to a third role', () => {
    const input = collectedInput();
    const mutated = withTemplate(
      input,
      (template) =>
        template.teamId === 'duo' &&
        template.fromRole === 'planner' &&
        template.toRole === 'architect' &&
        template.mode === 'code',
      (template) => ({
        ...template,
        text: `${template.text}

chatroom handoff --chatroom-id="audit" --role="architect" --next-role="triage"
`,
      })
    );

    const violation = violationFor(mutated, 'duo: planner → architect', 'return-path');
    expect(violation).toBeDefined();
    expect(violation?.message).toContain('duo: planner → architect');
  });

  test.each([
    ['duo: planner → builder', 'duo', 'planner', 'builder'],
    ['trio: specifier → builder', 'trio', 'specifier', 'builder'],
  ] as const)(
    'names the mismatched pair when %s drops the grounding artifact',
    (pair, teamId, fromRole, toRole) => {
      const input = collectedInput();
      const mutated = withTemplate(
        input,
        (template) =>
          template.teamId === teamId &&
          template.fromRole === fromRole &&
          template.toRole === toRole &&
          template.mode === 'code',
        (template) => ({
          ...template,
          text: template.text.replaceAll(GROUNDING_REFERENCE_HEADING, '### Reference'),
        })
      );

      const violation = violationFor(mutated, pair, 'grounding-mismatch');
      expect(violation).toBeDefined();
      expect(violation?.message).toContain(pair);
    }
  );

  test('checks the grounding command, not a --role elsewhere in the template', () => {
    const input = collectedInput();
    const mutated = withTemplate(
      input,
      (template) =>
        template.teamId === 'duo' &&
        template.fromRole === 'planner' &&
        template.toRole === 'builder' &&
        template.mode === 'code',
      (template) => {
        const headingIndex = template.text.indexOf(GROUNDING_REFERENCE_HEADING);
        expect(headingIndex).toBeGreaterThan(-1);
        const grounding = template.text.slice(headingIndex);
        return {
          ...template,
          text:
            template.text.slice(0, headingIndex) +
            grounding.replace('--role="builder"', '--role="architect"'),
        };
      }
    );

    const violation = violationFor(mutated, 'duo: planner → builder', 'grounding-mismatch');
    expect(violation).toBeDefined();
    expect(violation?.message).toContain('not addressed to the receiver "builder"');
  });

  test('every grounding-reference expectation has a rendered template', () => {
    const input = collectedInput();
    const rendered = new Set(
      input.templates.map(
        (template) => `${template.teamId}:${template.fromRole}→${template.toRole}`
      )
    );
    const missing = GROUNDING_REFERENCE_PAIRS.filter(
      (pair) => !rendered.has(`${pair.teamId}:${pair.fromRole}→${pair.toRole}`)
    );
    expect(missing).toEqual([]);
  });

  test('fails when a recipient guidance no longer states the context the table derives from it', () => {
    const input = collectedInput();
    const mutated: CrossRoleAuditInput = {
      ...input,
      rolePrompts: input.rolePrompts.map((prompt) =>
        prompt.teamId === 'trio' && prompt.role === 'reviewer'
          ? { ...prompt, text: prompt.text.replace('review target and focus', 'review scope') }
          : prompt
      ),
    };

    const violation = violationFor(
      mutated,
      'trio: coordinator → reviewer',
      'recipient-guidance-drift'
    );
    expect(violation).toBeDefined();
    expect(violation?.message).toContain('review target and focus');
  });

  test('fails every pair whose recipient has no declared context expectation', () => {
    const input = collectedInput();
    const recipientExpectations = { ...input.recipientExpectations };
    delete recipientExpectations['builder'];

    const violations = auditCrossRoleScript({ ...input, recipientExpectations });
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.every((violation) => violation.kind === 'missing-expectation')).toBe(true);
    expect(violations.every((violation) => violation.pair.endsWith('→ builder'))).toBe(true);
    expect(violations.every((violation) => violation.message.startsWith(violation.pair))).toBe(
      true
    );
  });
});
