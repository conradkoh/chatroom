import { describe, expect, test } from 'vitest';

import type { EnhancerJob, PendingEnhancerJob } from './enhancer-job.js';

describe('enhancer-job', () => {
  test('EnhancerJob shape has required spawn fields', () => {
    const job: EnhancerJob = {
      jobId: 'job1',
      chatroomId: 'room1',
      agentHarness: 'cursor',
      model: 'gpt-4',
      workingDir: '/workspace',
      systemPrompt: 'You are an enhancer.',
      taskEnvelope: 'task content',
    };
    expect(job.jobId).toBe('job1');
    expect(job.taskEnvelope).toBe('task content');
  });

  test('PendingEnhancerJob is a subset of EnhancerJob fields', () => {
    const pending: PendingEnhancerJob = {
      jobId: 'job1',
      chatroomId: 'room1',
    };
    expect(pending.jobId).toBe('job1');
    expect(pending.chatroomId).toBe('room1');
  });
});
