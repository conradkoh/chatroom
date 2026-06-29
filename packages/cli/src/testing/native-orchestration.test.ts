/**
 * Native orchestration closed-loop tests (RecordingHarness + runNativeInjectionEffect).
 */

import { describe, expect, test } from 'vitest';

import { NativeOrchestrationSimulator } from './native-orchestration-simulator.js';
import { RecordingHarness } from './recording-harness.js';

const PLANNER_DELIVERY = ['<task>', 'hello', '</task>', '<handoffs>', '**user**'].join('\n');

const BUILDER_DELIVERY = [
  '<task>',
  '## Goal',
  'Implement dark mode',
  '</task>',
  '<handoffs>',
  '**planner**',
].join('\n');

describe('RecordingHarness', () => {
  test('records resumeTurn prompts by role', async () => {
    const harness = new RecordingHarness();
    await harness.resumeTurnForSlot({
      chatroomId: 'room_1',
      role: 'planner',
      prompt: 'FIRST',
    });
    await harness.resumeTurnForSlot({
      chatroomId: 'room_1',
      role: 'builder',
      prompt: 'SECOND',
    });

    expect(harness.injections).toHaveLength(2);
    expect(harness.promptsFor('planner')).toEqual(['FIRST']);
    expect(harness.promptsFor('builder')).toEqual(['SECOND']);
  });
});

describe('NativeOrchestrationSimulator', () => {
  test('inject records delivery prompt for planner user message', async () => {
    const sim = new NativeOrchestrationSimulator();
    const task = NativeOrchestrationSimulator.makeTask({
      assignedTo: 'planner',
      taskContent: 'hello',
    });

    const prompt = await sim.inject({ task, deliveryOutput: PLANNER_DELIVERY });

    expect(prompt).toContain('hello');
    expect(prompt).not.toContain('Starting a new agent session');
    expect(prompt).not.toContain('Context was compacted');
    expect(sim.harness.injections).toHaveLength(1);
    expect(sim.harness.lastInjection()?.role).toBe('planner');
  });

  test('regression: planner builder handback has no session augmentation preamble', async () => {
    const sim = new NativeOrchestrationSimulator();
    const handbackContent = `## Summary
Implemented dark mode toggle.

## Changes Made
- Added theme switch`;

    const prompt = await sim.inject({
      task: NativeOrchestrationSimulator.makeTask({
        assignedTo: 'planner',
        taskContent: handbackContent,
      }),
      deliveryOutput: PLANNER_DELIVERY,
    });

    expect(prompt).toContain('hello');
    expect(prompt).not.toContain('Starting a new agent session');
    expect(prompt).not.toContain('Context was compacted');
  });

  test('regression: builder delegation without section gets new-session preamble', async () => {
    const sim = new NativeOrchestrationSimulator();
    const delegation = `## Goal
Add payments API

## Files to implement
- src/payments.ts`;

    const prompt = await sim.inject({
      task: NativeOrchestrationSimulator.makeTask({
        assignedTo: 'builder',
        taskContent: delegation,
        agentConfig: {
          role: 'builder',
          machineId: 'machine_1',
          agentHarness: 'opencode-sdk',
          workingDir: '/tmp/project',
          spawnedAgentPid: 12345,
          desiredState: 'running',
        },
      }),
      deliveryOutput: BUILDER_DELIVERY,
    });

    expect(prompt).toContain('Starting a new agent session');
    expect(prompt).toContain('Implement dark mode');
  });

  test('multi-turn: planner injection then builder injection after handoff', async () => {
    const sim = new NativeOrchestrationSimulator();

    await sim.inject({
      task: NativeOrchestrationSimulator.makeTask({
        taskId: 'task_planner' as never,
        assignedTo: 'planner',
        taskContent: 'hello',
      }),
      deliveryOutput: PLANNER_DELIVERY,
    });

    await sim.inject({
      task: NativeOrchestrationSimulator.makeTask({
        taskId: 'task_builder' as never,
        assignedTo: 'builder',
        taskContent:
          '## Goal\nImplement dark mode\n## Session Augmentation\n// data:agent.session_augmentation=compact',
        agentConfig: {
          role: 'builder',
          machineId: 'machine_1',
          agentHarness: 'opencode-sdk',
          workingDir: '/tmp/project',
          spawnedAgentPid: 12345,
          desiredState: 'running',
        },
      }),
      deliveryOutput: BUILDER_DELIVERY,
    });

    expect(sim.harness.injections).toHaveLength(2);
    expect(sim.harness.promptsFor('planner')[0]).toContain('hello');
    expect(sim.harness.promptsFor('builder')[0]).toContain('Context was compacted');
    expect(sim.harness.promptsFor('builder')[0]).toContain('Implement dark mode');
  });
});
