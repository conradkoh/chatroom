import { describe, expect, it } from 'vitest';

import { describeAgentOperation } from './describeAgentOperation';

describe('describeAgentOperation', () => {
  it('shows nothing for a pure successful start', () => {
    expect(
      describeAgentOperation({ requested: [{}, {}], skipped: [], failed: [] }, 'start')
    ).toBeNull();
  });

  it('drops applied favourites on a pure successful start', () => {
    expect(
      describeAgentOperation({ requested: [{}], skipped: [], failed: [] }, 'start', 1)
    ).toBeNull();
  });

  it('describes a partial restart failure with one item per failed agent', () => {
    expect(
      describeAgentOperation(
        {
          requested: [{ role: 'planner' }],
          skipped: [],
          failed: [
            { role: 'builder', error: 'Machine offline' },
            { role: 'reviewer', error: 'No workspace configured' },
          ],
        },
        'restart'
      )
    ).toEqual({
      tone: 'error',
      title: 'Failed to restart 2 agent(s)',
      message: 'Restart requested for 1 agent(s)',
      items: ['builder: Machine offline', 'reviewer: No workspace configured'],
    });
  });

  it('includes applied favourites inside a partial start failure', () => {
    expect(
      describeAgentOperation(
        { requested: [{}], skipped: [], failed: [{ error: 'Boom' }] },
        'start',
        1
      )
    ).toEqual({
      tone: 'error',
      title: 'Failed to start 1 agent(s)',
      message: 'Applied favourites to 1 agent(s). Start requested for 1 agent(s).',
      items: ['Boom'],
    });
  });

  it('omits the requested line when nothing was requested', () => {
    const result = describeAgentOperation(
      { requested: [], skipped: [], failed: [{ role: 'builder', error: 'Machine offline' }] },
      'start'
    );

    expect(result).toEqual({
      tone: 'error',
      title: 'Failed to start 1 agent(s)',
      items: ['builder: Machine offline'],
    });
    expect(result?.message).toBeUndefined();
  });

  it('reports missing saved configuration when nothing was requested or failed', () => {
    expect(describeAgentOperation({ requested: [], skipped: [], failed: [] }, 'restart')).toEqual({
      tone: 'error',
      message: 'No saved agent configuration is available.',
    });
  });

  it('lists the skip reasons when every agent was skipped for ownership or workspace reasons', () => {
    expect(
      describeAgentOperation(
        {
          requested: [],
          skipped: [
            { role: 'planner', reason: 'Saved machine is not available to the requester' },
            { role: 'builder', reason: 'Saved launch configuration is not for this workspace' },
          ],
          failed: [],
        },
        'start'
      )
    ).toEqual({
      tone: 'error',
      title: 'Failed to start 2 agent(s)',
      items: [
        'planner: Saved machine is not available to the requester',
        'builder: Saved launch configuration is not for this workspace',
      ],
    });
  });

  it('lists the skip reasons for a fully skipped restart', () => {
    expect(
      describeAgentOperation(
        {
          requested: [],
          skipped: [{ role: 'builder', reason: 'Workspace is not active in this chatroom' }],
          failed: [],
        },
        'restart'
      )
    ).toEqual({
      tone: 'error',
      title: 'Failed to restart 1 agent(s)',
      items: ['builder: Workspace is not active in this chatroom'],
    });
  });

  it('keeps the no-configuration message when every skip is a missing saved launch configuration', () => {
    expect(
      describeAgentOperation(
        {
          requested: [],
          skipped: [
            { role: 'planner', reason: 'No saved launch configuration' },
            { role: 'builder', reason: 'No saved launch configuration' },
          ],
          failed: [],
        },
        'start'
      )
    ).toEqual({ tone: 'error', message: 'No saved agent configuration is available.' });
  });

  it('shows nothing for a pure successful stop', () => {
    expect(describeAgentOperation({ requested: [{}], skipped: [], failed: [] }, 'stop')).toBeNull();
  });

  it('is silent for a stop with nothing requested and nothing failed', () => {
    expect(describeAgentOperation({ requested: [], skipped: [], failed: [] }, 'stop')).toBeNull();
  });

  it('describes a partial stop failure', () => {
    expect(
      describeAgentOperation(
        {
          requested: [{ role: 'planner' }],
          skipped: [],
          failed: [{ role: 'builder', error: 'Machine offline' }],
        },
        'stop'
      )
    ).toEqual({
      tone: 'error',
      title: 'Failed to stop 1 agent(s)',
      message: 'Stop requested for 1 agent(s)',
      items: ['builder: Machine offline'],
    });
  });

  it('describes a total stop failure without a requested line', () => {
    const result = describeAgentOperation(
      { requested: [], skipped: [], failed: [{ role: 'builder', error: 'Machine offline' }] },
      'stop'
    );

    expect(result).toEqual({
      tone: 'error',
      title: 'Failed to stop 1 agent(s)',
      items: ['builder: Machine offline'],
    });
    expect(result?.message).toBeUndefined();
  });
});
