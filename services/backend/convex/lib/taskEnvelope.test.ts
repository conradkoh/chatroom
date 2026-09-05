/**
 * Persisted TaskEnvelopeV1 validator — shape contract tests.
 *
 * Pins the Convex validator for the persisted TaskEnvelopeV1 snapshot to the
 * canonical shared contract vocabulary, verifies there is no optionality inside
 * the envelope itself, and confirms both queue/task tables attach it via
 * v.optional (so legacy rows and existing writers remain valid).
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { taskEnvelopeV1Validator, type PersistedTaskEnvelopeV1 } from './taskEnvelope';

const CANONICAL_CONVERSATION_MODES = ['chat', 'code', 'code:enhanced'];
const CANONICAL_SESSION_POLICIES = ['continue', 'new'];
const CANONICAL_PRESETS = ['direct', 'team', 'enhanced-team'];
const CANONICAL_PHASES = ['entry', 'enhancement', 'implementation', 'delivery'];

function literalValues(validator: { members: readonly { value: string }[] }): string[] {
  return validator.members.map((member) => member.value);
}

function envelopeFields(): Record<string, any> {
  const fields = taskEnvelopeV1Validator.fields as Record<string, any>;
  return fields;
}

describe('taskEnvelopeV1Validator shape', () => {
  test('validator exists and is an object validator', () => {
    expect(taskEnvelopeV1Validator).toBeDefined();
    expect(taskEnvelopeV1Validator.kind).toBe('object');
  });

  test('top-level fields are exactly version, conversationMode, sessionPolicy, handoffWorkflow', () => {
    expect(Object.keys(envelopeFields())).toEqual([
      'version',
      'conversationMode',
      'sessionPolicy',
      'handoffWorkflow',
    ]);
  });

  test('nested workflow fields are exactly preset and phase', () => {
    expect(Object.keys(envelopeFields().handoffWorkflow.fields)).toEqual(['preset', 'phase']);
  });

  test('version is the literal 1', () => {
    const version = envelopeFields().version;
    expect(version.kind).toBe('literal');
    expect(version.value).toBe(1);
  });

  test('literal member sets match the canonical values', () => {
    expect(literalValues(envelopeFields().conversationMode)).toEqual(CANONICAL_CONVERSATION_MODES);
    expect(literalValues(envelopeFields().sessionPolicy)).toEqual(CANONICAL_SESSION_POLICIES);
    const workflowFields = envelopeFields().handoffWorkflow.fields;
    expect(literalValues(workflowFields.preset)).toEqual(CANONICAL_PRESETS);
    expect(literalValues(workflowFields.phase)).toEqual(CANONICAL_PHASES);
  });

  test('no optionality exists inside the envelope itself', () => {
    const fields = envelopeFields();
    expect(taskEnvelopeV1Validator.isOptional).toBe('required');
    expect(fields.version.isOptional).toBe('required');
    expect(fields.conversationMode.isOptional).toBe('required');
    expect(fields.sessionPolicy.isOptional).toBe('required');
    expect(fields.handoffWorkflow.isOptional).toBe('required');
    expect(fields.handoffWorkflow.fields.preset.isOptional).toBe('required');
    expect(fields.handoffWorkflow.fields.phase.isOptional).toBe('required');
  });

  test('exported inferred type is the validator type', () => {
    const typedValue: PersistedTaskEnvelopeV1 = {
      version: 1,
      conversationMode: 'chat',
      sessionPolicy: 'continue',
      handoffWorkflow: { preset: 'direct', phase: 'entry' },
    };
    expect(typedValue.version).toBe(1);
    expect(typedValue.handoffWorkflow.preset).toBe('direct');
  });
});

describe('schema attach points', () => {
  const schemaSource = fs.readFileSync(path.resolve(__dirname, '../schema.ts'), 'utf8');

  test('both queue/task tables attach taskEnvelope via v.optional', () => {
    const messageQueueBlock = schemaSource.match(
      /chatroom_messageQueue: defineTable\(\{([\s\S]*?)\}\)/
    )?.[1];
    const tasksBlock = schemaSource.match(/chatroom_tasks: defineTable\(\{([\s\S]*?)\}\)/)?.[1];

    expect(messageQueueBlock).toBeDefined();
    expect(tasksBlock).toBeDefined();
    for (const block of [messageQueueBlock, tasksBlock]) {
      expect(block).toContain('taskEnvelope: v.optional(taskEnvelopeV1Validator)');
    }
  });

  test('legacy policy scalar fields remain present and optional in both tables', () => {
    const messageQueueBlock = schemaSource.match(
      /chatroom_messageQueue: defineTable\(\{([\s\S]*?)\}\)/
    )?.[1];
    const tasksBlock = schemaSource.match(/chatroom_tasks: defineTable\(\{([\s\S]*?)\}\)/)?.[1];

    for (const block of [messageQueueBlock, tasksBlock]) {
      expect(block).toContain('plannerEnhancerEnabled: v.optional(v.boolean())');
      expect(block).toContain('conversationMode: v.optional(');
      expect(block).toContain('startInNewSession: v.optional(v.boolean())');
    }
  });

  test('schema imports the shared validator module', () => {
    expect(schemaSource).toContain("import { taskEnvelopeV1Validator } from './lib/taskEnvelope';");
  });
});
