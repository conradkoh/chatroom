import { describe, expect, test } from 'vitest';
import { beginMachineStopExecution } from './begin-machine-stop-execution';
describe('beginMachineStopExecution', () => { test('is exported as guarded execution use case', () => { expect(typeof beginMachineStopExecution).toBe('function'); }); });
