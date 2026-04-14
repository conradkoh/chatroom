/**
 * Prompt disclosure tests for the workflow skill.
 *
 * Verifies that structural decisions guidance appears in the workflow
 * skill prompt and the glossary, ensuring agents receive the right
 * architectural context when planning workflow steps.
 */

import { describe, it, expect } from 'vitest';
import { workflowSkill } from '../../../src/domain/usecase/skills/modules/workflow';
import { GLOSSARY_TERMS } from '../../../prompts/sections/glossary';

describe('workflow skill prompt disclosure', () => {
  const prompt = workflowSkill.getPrompt('');

  it('contains structural decisions guidance', () => {
    expect(prompt).toContain('structural decisions');
  });

  it('mentions key structural concepts', () => {
    expect(prompt).toContain('Folder structure');
    expect(prompt).toContain('Interface definitions');
    expect(prompt).toContain('Key abstraction');
  });

  it('references the specification example', () => {
    expect(prompt).toContain('See the "Specification Example"');
  });
});

describe('glossary structural-decisions term', () => {
  const term = GLOSSARY_TERMS.find((t) => t.term === 'structural-decisions');

  it('exists in glossary', () => {
    expect(term).toBeDefined();
  });

  it('has definition mentioning key concepts', () => {
    expect(term?.definition).toContain('folder structure');
    expect(term?.definition).toContain('interface definitions');
    expect(term?.definition).toContain('abstraction');
  });
});
