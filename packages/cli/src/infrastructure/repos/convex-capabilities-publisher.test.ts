import { describe, it, expect, vi } from 'vitest';

import { ConvexCapabilitiesPublisher } from './convex-capabilities-publisher.js';
import type { MachineCapabilities } from '../../domain/index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createBackend() {
  return { mutation: vi.fn() };
}

function createPublisher(backend?: ReturnType<typeof createBackend>) {
  const b = backend ?? createBackend();
  return {
    publisher: new ConvexCapabilitiesPublisher({ backend: b, sessionId: 'mock-session-id' }),
    backend: b,
  };
}

const defaultCaps: MachineCapabilities = {
  machineId: 'machine-1',
  workspaces: [
    {
      workspaceId: 'ws-1',
      cwd: '/test/ws',
      name: 'Test',
      harnesses: [
        {
          name: 'opencode-sdk',
          displayName: 'OpenCode SDK',
          agents: [
            { name: 'builder', mode: 'primary' },
            { name: 'planner', mode: 'primary', model: { providerID: 'openai', modelID: 'gpt-4' } },
          ],
          providers: [
            {
              providerID: 'openai',
              name: 'OpenAI',
              models: [{ modelID: 'gpt-4', name: 'GPT-4' }],
            },
          ],
        },
      ],
    },
  ],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ConvexCapabilitiesPublisher', () => {
  it('publishes machine capabilities with full workspace/harness data', async () => {
    const { publisher, backend } = createPublisher();

    await publisher.publish(defaultCaps);

    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: 'mock-session-id',
        machineId: 'machine-1',
        workspaces: [
          expect.objectContaining({
            workspaceId: 'ws-1',
            cwd: '/test/ws',
            name: 'Test',
            harnesses: [
              expect.objectContaining({
                name: 'opencode-sdk',
                displayName: 'OpenCode SDK',
                agents: [
                  { name: 'builder', mode: 'primary' },
                  { name: 'planner', mode: 'primary', model: { providerID: 'openai', modelID: 'gpt-4' } },
                ],
                providers: [
                  {
                    providerID: 'openai',
                    name: 'OpenAI',
                    models: [{ modelID: 'gpt-4', name: 'GPT-4' }],
                  },
                ],
              }),
            ],
          }),
        ],
      })
    );
  });

  it('publishes empty harness list when no harnesses', async () => {
    const { publisher, backend } = createPublisher();

    const caps: MachineCapabilities = {
      machineId: 'machine-2',
      workspaces: [
        { workspaceId: 'ws-2', cwd: '/empty/ws', name: 'Empty', harnesses: [] },
      ],
    };

    await publisher.publish(caps);

    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        machineId: 'machine-2',
        workspaces: [
          { workspaceId: 'ws-2', cwd: '/empty/ws', name: 'Empty', harnesses: [] },
        ],
      })
    );
  });

  it('includes optional fields (configSchema, description) when present', async () => {
    const { publisher, backend } = createPublisher();

    const caps: MachineCapabilities = {
      machineId: 'machine-3',
      workspaces: [
        {
          workspaceId: 'ws-3',
          cwd: '/test/ws',
          name: 'Rich',
          harnesses: [
            {
              name: 'custom',
              displayName: 'Custom',
              configSchema: { type: 'object' },
              agents: [
                { name: 'agent-x', mode: 'all', description: 'The X agent' },
              ],
              providers: [],
            },
          ],
        },
      ],
    };

    await publisher.publish(caps);

    const workspace = backend.mutation.mock.calls[0][1].workspaces[0];
    const harness = workspace.harnesses[0];

    expect(harness).toHaveProperty('configSchema', { type: 'object' });
    expect(harness.agents[0]).toHaveProperty('description', 'The X agent');
  });
});
