'use client';

import { useCallback } from 'react';

import { useChatroomExport } from './useChatroomExport';
import { useTransferFeedbackSlot } from './useTransferFeedbackSlot';
import {
  chatroomExportFailure,
  chatroomExportingLabel,
  chatroomExportSuccess,
} from '../lib/transferCopy';

import type { Feedback } from '@/components/inline-feedback';

export interface ChatroomExportAction {
  exporting: boolean;
  label: string;
  feedback: Feedback | null;
  /** True when the current error may be retried with `start()`. */
  retryable: boolean;
  start(): void;
  dismiss(): void;
}

export function useChatroomExportAction(
  chatroomId: string,
  name: string | null
): ChatroomExportAction {
  const { state, run } = useChatroomExport();
  const { feedback, retryable, show, setRetryable, begin, finish, dismiss } =
    useTransferFeedbackSlot();

  const start = useCallback(() => {
    if (!begin()) return;
    void run(chatroomId)
      .then((outcome) => {
        if (outcome.ok) {
          const success = chatroomExportSuccess({
            name,
            fileName: outcome.fileName,
            omitted: outcome.omitted,
          });
          show('success', success.message, success.items ? { items: success.items } : undefined);
          return;
        }
        const copy = chatroomExportFailure(outcome.failure);
        show('error', copy.message, { title: copy.title });
        setRetryable(copy.retryable);
      })
      .finally(finish);
  }, [begin, chatroomId, finish, name, run, setRetryable, show]);

  return {
    exporting: state === 'running',
    label: chatroomExportingLabel(name),
    feedback,
    retryable,
    start,
    dismiss,
  };
}
