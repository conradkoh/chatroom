import { describe, it, expect } from 'vitest';
import { mergeHarnessCapabilities } from '../../../convex/chatroom/directHarness/capabilities.js';

const WORKSPACE_ID = 'ws-001';

describe('mergeHarnessCapabilities', () => {
  it('returns empty array for empty entries', () => {
    expect(mergeHarnessCapabilities([], WORKSPACE_ID)).toEqual([]);
  });

  it('returns harness summary for single machine with one harness', () => {
    const entries = [
      {
        workspaces: [
          {
            workspaceId: WORKSPACE_ID,
            harnesses: [
              {
                name: 'default',
                displayName: 'Default Harness',
                agents: [{ name: 'agent-a', mode: 'primary' as const }],
                providers: [
                  {
                    providerID: 'openai',
                    name: 'OpenAI',
                    models: [{ modelID: 'gpt-4o', name: 'GPT-4o' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    const result = mergeHarnessCapabilities(entries, WORKSPACE_ID);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('default');
    expect(result[0].agents).toHaveLength(1);
    expect(result[0].agents[0].name).toBe('agent-a');
    expect(result[0].providers).toHaveLength(1);
    expect(result[0].providers[0].models).toHaveLength(1);
  });

  it('skips entries that do not include the requested workspace', () => {
    const entries = [
      {
        workspaces: [
          {
            workspaceId: 'other-workspace',
            harnesses: [
              {
                name: 'default',
                displayName: 'Default',
                agents: [],
                providers: [],
              },
            ],
          },
        ],
      },
    ];

    expect(mergeHarnessCapabilities(entries, WORKSPACE_ID)).toEqual([]);
  });

  it('deduplicates agents and providers across two machines with overlapping harness', () => {
    const entries = [
      {
        workspaces: [
          {
            workspaceId: WORKSPACE_ID,
            harnesses: [
              {
                name: 'default',
                displayName: 'Default v1',
                agents: [
                  { name: 'agent-a', mode: 'primary' as const, description: 'Machine 1 agent-a' },
                  { name: 'agent-b', mode: 'subagent' as const },
                ],
                providers: [
                  {
                    providerID: 'openai',
                    name: 'OpenAI Machine1',
                    models: [
                      { modelID: 'gpt-4o', name: 'GPT-4o' },
                      { modelID: 'gpt-3.5', name: 'GPT-3.5' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        workspaces: [
          {
            workspaceId: WORKSPACE_ID,
            harnesses: [
              {
                name: 'default',
                displayName: 'Default v2', // last writer wins
                agents: [
                  { name: 'agent-a', mode: 'all' as const, description: 'Machine 2 agent-a' }, // overrides
                  { name: 'agent-c', mode: 'subagent' as const },
                ],
                providers: [
                  {
                    providerID: 'openai',
                    name: 'OpenAI Machine2', // last writer wins
                    models: [
                      { modelID: 'gpt-4o', name: 'GPT-4o-updated' }, // overrides
                      { modelID: 'gpt-4-turbo', name: 'GPT-4 Turbo' }, // new model
                    ],
                  },
                  {
                    providerID: 'anthropic',
                    name: 'Anthropic',
                    models: [{ modelID: 'claude-3', name: 'Claude 3' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    const result = mergeHarnessCapabilities(entries, WORKSPACE_ID);
    expect(result).toHaveLength(1);
    const harness = result[0];

    // Last writer wins for displayName
    expect(harness.displayName).toBe('Default v2');

    // Agents: a overridden, b and c present
    const agentNames = harness.agents.map((a) => a.name).sort();
    expect(agentNames).toEqual(['agent-a', 'agent-b', 'agent-c']);
    const agentA = harness.agents.find((a) => a.name === 'agent-a')!;
    expect(agentA.mode).toBe('all');
    expect(agentA.description).toBe('Machine 2 agent-a');

    // Providers: openai merged, anthropic added
    const providerIDs = harness.providers.map((p) => p.providerID).sort();
    expect(providerIDs).toEqual(['anthropic', 'openai']);

    const openai = harness.providers.find((p) => p.providerID === 'openai')!;
    expect(openai.name).toBe('OpenAI Machine2');
    const modelIDs = openai.models.map((m) => m.modelID).sort();
    expect(modelIDs).toEqual(['gpt-3.5', 'gpt-4-turbo', 'gpt-4o']);
    const gpt4o = openai.models.find((m) => m.modelID === 'gpt-4o')!;
    expect(gpt4o.name).toBe('GPT-4o-updated');
  });
});
