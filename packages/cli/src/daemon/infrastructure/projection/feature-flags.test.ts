import { afterEach, describe, expect, it } from 'vitest';

import {
  isDaemonOrchestrationP7CutoverEnabled,
  isDaemonOrchestrationP7Enabled,
} from './feature-flags.js';

const P7 = 'DAEMON_ORCHESTRATION_P7';
const P7_CUTOVER = 'DAEMON_ORCHESTRATION_P7_CUTOVER';

describe('P7 feature flags', () => {
  afterEach(() => {
    delete process.env[P7];
    delete process.env[P7_CUTOVER];
  });

  it('isDaemonOrchestrationP7Enabled reads DAEMON_ORCHESTRATION_P7', () => {
    expect(isDaemonOrchestrationP7Enabled()).toBe(false);

    process.env[P7] = '1';
    expect(isDaemonOrchestrationP7Enabled()).toBe(true);

    process.env[P7] = 'true';
    expect(isDaemonOrchestrationP7Enabled()).toBe(true);

    process.env[P7] = '0';
    expect(isDaemonOrchestrationP7Enabled()).toBe(false);
  });

  it('isDaemonOrchestrationP7CutoverEnabled reads DAEMON_ORCHESTRATION_P7_CUTOVER', () => {
    expect(isDaemonOrchestrationP7CutoverEnabled()).toBe(false);

    process.env[P7_CUTOVER] = '1';
    expect(isDaemonOrchestrationP7CutoverEnabled()).toBe(true);

    process.env[P7_CUTOVER] = 'true';
    expect(isDaemonOrchestrationP7CutoverEnabled()).toBe(true);

    process.env[P7_CUTOVER] = '0';
    expect(isDaemonOrchestrationP7CutoverEnabled()).toBe(false);
  });
});
