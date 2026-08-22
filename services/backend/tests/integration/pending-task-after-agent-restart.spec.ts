/** Phase E: backend task snapshots remain task-only after an agent restart. */
import { describe, expect, test } from 'vitest';

describe('Phase E — pending task after agent restart', () => {
  test('slim snapshot contract does not carry operational fields', () => {
    const taskSnapshot = { taskId: 'task', status: 'pending', agentConfig: { role: 'builder', agentHarness: 'cursor-sdk', workingDir: '/tmp' } };
    expect(taskSnapshot.agentConfig).not.toHaveProperty('desiredState');
    expect(taskSnapshot.agentConfig).not.toHaveProperty('spawnedAgentPid');
  });
});
