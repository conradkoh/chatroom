import { describe, expect, test } from 'vitest';

import { completeMachineStopExecution } from './complete-machine-stop-execution';

describe('completeMachineStopExecution', () => {
  test('is exported as completion use case', () => {
    expect(typeof completeMachineStopExecution).toBe('function');
  });
});
