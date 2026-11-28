import { describe, expect, test } from 'vitest';

import {
  auditCrossRoleScript,
  collectCrossRoleAuditInput,
  type CrossRoleAuditInput,
  type CrossRoleViolationKind,
  type RenderedHandoffTemplate,
} from './cross-role-script-audit';

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
    expect(auditCrossRoleScript(collectCrossRoleAuditInput())).toEqual([]);
  });

  test('declares a context expectation for every recipient role', () => {
    const input = collectCrossRoleAuditInput();
    const recipients = new Set(
      input.templates.map((template) => template.toRole).filter((role) => role !== 'user')
    );
    expect([...recipients].filter((role) => !(role in input.recipientExpectations))).toEqual([]);
  });

  test('names the mismatched pair when a prompt advertises an undeclared target', () => {
    const input = collectCrossRoleAuditInput();
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

  test('names the mismatched pair when the delegator omits context the recipient expects', () => {
    const input = collectCrossRoleAuditInput();
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
    const input = collectCrossRoleAuditInput();
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

  test('names the mismatched pair when a template drops the grounding artifact', () => {
    const input = collectCrossRoleAuditInput();
    const mutated = withTemplate(
      input,
      (template) =>
        template.teamId === 'trio' &&
        template.fromRole === 'coordinator' &&
        template.toRole === 'architect' &&
        template.mode === 'code',
      (template) => ({
        ...template,
        text: template.text.replaceAll('### Grounding reference', '### Reference'),
      })
    );

    const violation = violationFor(mutated, 'trio: coordinator → architect', 'grounding-mismatch');
    expect(violation).toBeDefined();
    expect(violation?.message).toContain('trio: coordinator → architect');
  });

  test('fails every pair whose recipient has no declared context expectation', () => {
    const input = collectCrossRoleAuditInput();
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
