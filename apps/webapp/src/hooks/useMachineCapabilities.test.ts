import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMachineCapabilities } from './useMachineCapabilities';

const mocks = vi.hoisted(() => ({
  result: undefined as unknown,
  args: undefined as unknown,
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (_query: unknown, args: unknown) => {
    mocks.args = args;
    return mocks.result;
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: { machines: { getMachineCapabilities: 'machines:getMachineCapabilities' } },
}));

describe('useMachineCapabilities', () => {
  beforeEach(() => {
    mocks.result = undefined;
    mocks.args = undefined;
  });

  it('skips the query for a null machine and reports nothing', () => {
    const { result } = renderHook(() => useMachineCapabilities(null));
    expect(mocks.args).toBe('skip');
    expect(result.current).toEqual({
      availableHarnesses: [],
      harnessVersions: {},
      reported: false,
      isLoading: false,
    });
  });

  it('is loading and unreported while the query is pending', () => {
    mocks.result = undefined;
    const { result } = renderHook(() => useMachineCapabilities('m1'));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.reported).toBe(false);
  });

  it('reports a reported empty list as reported with no harnesses', () => {
    mocks.result = { availableHarnesses: [], harnessVersions: {}, reported: true };
    const { result } = renderHook(() => useMachineCapabilities('m1'));
    expect(result.current).toEqual({
      availableHarnesses: [],
      harnessVersions: {},
      reported: true,
      isLoading: false,
    });
  });

  it('reports an unreported machine as not reported', () => {
    mocks.result = { availableHarnesses: [], harnessVersions: {}, reported: false };
    const { result } = renderHook(() => useMachineCapabilities('m1'));
    expect(result.current.reported).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('reports a reported list with its harnesses', () => {
    mocks.result = { availableHarnesses: ['opencode-sdk'], harnessVersions: {}, reported: true };
    const { result } = renderHook(() => useMachineCapabilities('m1'));
    expect(result.current.availableHarnesses).toEqual(['opencode-sdk']);
    expect(result.current.reported).toBe(true);
  });
});
