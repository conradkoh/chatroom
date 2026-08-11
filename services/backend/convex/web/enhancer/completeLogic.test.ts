import { beforeEach, describe, expect, test, vi } from 'vitest';

import { applyEnhancerComplete } from './completeLogic';
import type { Id } from '../../_generated/dataModel';
import { performHandoffFromEnhancer } from '../../messages';

vi.mock('../../messages', () => ({
  performHandoffFromEnhancer: vi.fn(),
}));

vi.mock('./internal', () => ({
  emitEnhancerEvent: vi.fn(),
}));

const performHandoffMock = vi.mocked(performHandoffFromEnhancer);

function makeContext(job: Record<string, unknown>) {
  const patch = vi.fn();
  return {
    ctx: {
      db: {
        get: vi.fn().mockResolvedValue(job),
        patch,
      },
    } as never,
    patch,
  };
}

function makeJob(handoffMessageId?: string): Record<string, unknown> {
  return {
    _id: 'job_1',
    chatroomId: 'room_1',
    status: 'running',
    attemptCount: 1,
    handoffMessageId,
    pendingHandoffArgs: {
      senderRole: 'planner',
      targetRole: 'planner',
    },
  };
}

describe('applyEnhancerComplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    performHandoffMock.mockResolvedValue({ success: true } as never);
  });

  test('delivers recovery instructions while storing raw enhanced content', async () => {
    const { ctx, patch } = makeContext(makeJob('message_original') as never);

    const result = await applyEnhancerComplete(ctx, {
      jobId: 'job_1' as Id<'chatroom_enhancerJobs'>,
      enhancedContent: '  ## Summary\nEnhanced result  ',
      sessionId: 'session_1',
    });

    expect(result).toEqual({ ok: true });
    expect(performHandoffMock).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        content: expect.stringContaining('## Summary\nEnhanced result'),
      })
    );
    const deliveredContent = performHandoffMock.mock.calls[0]?.[1].content;
    expect(deliveredContent).toContain('--chatroom-id="room_1"');
    expect(deliveredContent).toContain('--since-message-id="message_original"');
    expect(deliveredContent).toContain('--limit=1');
    expect(deliveredContent).toContain('original-planner-handoff');
    expect(deliveredContent).toContain('cat');
    expect(patch).toHaveBeenCalledWith(
      'chatroom_enhancerJobs',
      'job_1',
      expect.objectContaining({ enhancedContent: '## Summary\nEnhanced result' })
    );
  });

  test('keeps legacy delivery unchanged without an original handoff message', async () => {
    const { ctx, patch } = makeContext(makeJob());

    const result = await applyEnhancerComplete(ctx, {
      jobId: 'job_1' as Id<'chatroom_enhancerJobs'>,
      enhancedContent: 'Enhanced result',
      sessionId: 'session_1',
    });

    expect(result).toEqual({ ok: true });
    expect(performHandoffMock.mock.calls[0]?.[1].content).toBe('Enhanced result');
    expect(patch).toHaveBeenCalledWith(
      'chatroom_enhancerJobs',
      'job_1',
      expect.objectContaining({ enhancedContent: 'Enhanced result' })
    );
  });
});
