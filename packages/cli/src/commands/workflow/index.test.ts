/**
 * Workflow parseSections Unit Tests
 *
 * Tests the section parsing logic used by the `workflow specify` command.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseSections } from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let exitSpy: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let errorSpy: any;

beforeEach(() => {
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit called');
  }) as never);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseSections', () => {
  it('parses 2 required sections (GOAL, REQUIREMENTS)', () => {
    const input = `---GOAL---
Implement the feature
---REQUIREMENTS---
Must pass all tests`;

    const result = parseSections(input, ['GOAL', 'REQUIREMENTS'], ['WARNINGS']);

    expect(result.get('GOAL')).toBe('Implement the feature');
    expect(result.get('REQUIREMENTS')).toBe('Must pass all tests');
    expect(result.has('WARNINGS')).toBe(false);
  });

  it('parses all 3 sections (GOAL, REQUIREMENTS, WARNINGS)', () => {
    const input = `---GOAL---
Build the widget
---REQUIREMENTS---
Must be responsive
---WARNINGS---
Do not break existing tests`;

    const result = parseSections(input, ['GOAL', 'REQUIREMENTS'], ['WARNINGS']);

    expect(result.get('GOAL')).toBe('Build the widget');
    expect(result.get('REQUIREMENTS')).toBe('Must be responsive');
    expect(result.get('WARNINGS')).toBe('Do not break existing tests');
  });

  it('handles multi-line content in sections', () => {
    const input = `---GOAL---
Line 1 of goal
Line 2 of goal
Line 3 of goal
---REQUIREMENTS---
- Requirement A
- Requirement B
- Requirement C`;

    const result = parseSections(input, ['GOAL', 'REQUIREMENTS'], ['WARNINGS']);

    expect(result.get('GOAL')).toBe('Line 1 of goal\nLine 2 of goal\nLine 3 of goal');
    expect(result.get('REQUIREMENTS')).toBe('- Requirement A\n- Requirement B\n- Requirement C');
  });

  it('calls process.exit(1) when a required section is missing', () => {
    const input = `---GOAL---
Some goal text`;

    expect(() => {
      parseSections(input, ['GOAL', 'REQUIREMENTS'], ['WARNINGS']);
    }).toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Missing required section: ---REQUIREMENTS---')
    );
  });

  it('calls process.exit(1) when a required section is empty', () => {
    const input = `---GOAL---

---REQUIREMENTS---
Some requirements`;

    expect(() => {
      parseSections(input, ['GOAL', 'REQUIREMENTS'], ['WARNINGS']);
    }).toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Missing required section: ---GOAL---')
    );
  });

  it('trims whitespace from section content', () => {
    const input = `---GOAL---

  Indented goal with whitespace  

---REQUIREMENTS---
  Requirements text  
`;

    const result = parseSections(input, ['GOAL', 'REQUIREMENTS'], ['WARNINGS']);

    expect(result.get('GOAL')).toBe('Indented goal with whitespace');
    expect(result.get('REQUIREMENTS')).toBe('Requirements text');
  });

  it('does not leak section marker text into previous section content', () => {
    const input = `---GOAL---
My goal
---REQUIREMENTS---
My requirements
---WARNINGS---
My warnings`;

    const result = parseSections(input, ['GOAL', 'REQUIREMENTS'], ['WARNINGS']);

    // The key bug that was fixed — ensure no marker text leaks
    expect(result.get('GOAL')).not.toContain('---');
    expect(result.get('REQUIREMENTS')).not.toContain('---');
    expect(result.get('GOAL')).toBe('My goal');
    expect(result.get('REQUIREMENTS')).toBe('My requirements');
    expect(result.get('WARNINGS')).toBe('My warnings');
  });
});

// ---------------------------------------------------------------------------
// createWorkflow field stripping tests
// ---------------------------------------------------------------------------

describe('createWorkflow', () => {
  it('strips unknown fields from step JSON before sending to backend', async () => {
    const { createWorkflow } = await import('./index.js');

    const mutationSpy = vi.fn().mockResolvedValue({ workflowId: 'test-workflow-id' });

    const deps = {
      backend: {
        mutation: mutationSpy,
        query: vi.fn(),
      },
      session: {
        getSessionId: () => 'test-session',
        getConvexUrl: () => 'http://test:3210',
        getOtherSessionUrls: () => [],
      },
    };

    const stdinContent = JSON.stringify({
      steps: [
        {
          stepKey: 'step1',
          description: 'First step',
          dependsOn: [],
          order: 1,
          label: 'Backend',
          role: 'builder',
          name: 'Extra Name',
        },
      ],
    });

    await createWorkflow(
      // Use a valid-looking chatroom ID (20-40 chars)
      'test-chatroom-id-1234567890' as string,
      { role: 'planner', workflowKey: 'test-wf', stdinContent },
      deps as any
    );

    // Verify mutation was called with clean steps (no extra fields)
    expect(mutationSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        steps: [
          {
            stepKey: 'step1',
            description: 'First step',
            dependsOn: [],
            order: 1,
          },
        ],
      })
    );

    // Verify extra fields were NOT passed
    const passedSteps = mutationSpy.mock.calls[0][1].steps;
    expect(passedSteps[0]).not.toHaveProperty('label');
    expect(passedSteps[0]).not.toHaveProperty('role');
    expect(passedSteps[0]).not.toHaveProperty('name');
  });

  it('warns when extra fields are detected in step JSON', async () => {
    const { createWorkflow } = await import('./index.js');

    const mutationSpy = vi.fn().mockResolvedValue({ workflowId: 'test-workflow-id' });

    const deps = {
      backend: {
        mutation: mutationSpy,
        query: vi.fn(),
      },
      session: {
        getSessionId: () => 'test-session',
        getConvexUrl: () => 'http://test:3210',
        getOtherSessionUrls: () => [],
      },
    };

    const stdinContent = JSON.stringify({
      steps: [
        {
          stepKey: 'step1',
          description: 'First step',
          dependsOn: [],
          order: 1,
          label: 'Backend',
        },
      ],
    });

    await createWorkflow(
      'test-chatroom-id-1234567890' as string,
      { role: 'planner', workflowKey: 'test-wf-2', stdinContent },
      deps as any
    );

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Stripped unknown fields from step "step1": label')
    );
  });
});
