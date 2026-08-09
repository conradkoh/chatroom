import { afterEach, describe, expect, it } from 'vitest';

import {
  isDaemonOrchestrationP7CutoverEnabled,
  isDaemonOrchestrationP7Enabled,
  isDaemonOrchestrationP8CutoverEnabled,
  isDaemonOrchestrationP8Enabled,
} from './feature-flags.js';

const P7 = 'DAEMON_ORCHESTRATION_P7';
const P7_CUTOVER = 'DAEMON_ORCHESTRATION_P7_CUTOVER';
const P8 = 'DAEMON_ORCHESTRATION_P8';
const P8_CUTOVER = 'DAEMON_ORCHESTRATION_P8_CUTOVER';

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

describe('P8 feature flags', () => {
  afterEach(() => {
    delete process.env[P8];
    delete process.env[P8_CUTOVER];
  });

  it('isDaemonOrchestrationP8Enabled reads DAEMON_ORCHESTRATION_P8', () => {
    expect(isDaemonOrchestrationP8Enabled()).toBe(false);

    process.env[P8] = '1';
    expect(isDaemonOrchestrationP8Enabled()).toBe(true);

    process.env[P8] = 'true';
    expect(isDaemonOrchestrationP8Enabled()).toBe(true);

    process.env[P8] = '0';
    expect(isDaemonOrchestrationP8Enabled()).toBe(false);
  });

  it('isDaemonOrchestrationP8CutoverEnabled reads DAEMON_ORCHESTRATION_P8_CUTOVER', () => {
    expect(isDaemonOrchestrationP8CutoverEnabled()).toBe(false);

    process.env[P8_CUTOVER] = '1';
    expect(isDaemonOrchestrationP8CutoverEnabled()).toBe(true);

    process.env[P8_CUTOVER] = 'true';
    expect(isDaemonOrchestrationP8CutoverEnabled()).toBe(true);

    process.env[P8_CUTOVER] = '0';
    expect(isDaemonOrchestrationP8CutoverEnabled()).toBe(false);
  });
});
