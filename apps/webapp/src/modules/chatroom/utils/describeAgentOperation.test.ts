import { describe, expect, it } from 'vitest';

import { describeAgentOperation } from './describeAgentOperation';

describe('describeAgentOperation', () => {
  it('shows nothing for a pure successful start', () => {
    expect(describeAgentOperation({ requested: [{}, {}], failed: [] }, 'start')).toBeNull();
  });

  it('drops applied favourites on a pure successful start', () => {
    expect(describeAgentOperation({ requested: [{}], failed: [] }, 'start', 1)).toBeNull();
  });

  it('describes a partial restart failure with one item per failed agent', () => {
    expect(
      describeAgentOperation(
        {
          requested: [{ role: 'planner' }],
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
      describeAgentOperation({ requested: [{}], failed: [{ error: 'Boom' }] }, 'start', 1)
    ).toEqual({
      tone: 'error',
      title: 'Failed to start 1 agent(s)',
      message: 'Applied favourites to 1 agent(s). Start requested for 1 agent(s).',
      items: ['Boom'],
    });
  });

  it('omits the requested line when nothing was requested', () => {
    const result = describeAgentOperation(
      { requested: [], failed: [{ role: 'builder', error: 'Machine offline' }] },
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
    expect(describeAgentOperation({ requested: [], failed: [] }, 'restart')).toEqual({
      tone: 'error',
      message: 'No saved agent configuration is available.',
    });
  });
});
