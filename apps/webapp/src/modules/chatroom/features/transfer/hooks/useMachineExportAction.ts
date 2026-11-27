'use client';

import { useCallback } from 'react';

import { useMachineExport, type MachineExportState } from './useMachineExport';
import { useTransferFeedbackSlot } from './useTransferFeedbackSlot';
import {
  EXPORT_CANCELLED_COPY,
  MACHINE_EMPTY_COPY,
  machineExportFailure,
  machineExportSuccess,
} from '../lib/transferCopy';

import type { Feedback } from '@/components/inline-feedback';

export interface MachineExportAction {
  phase: MachineExportState;
  feedback: Feedback | null;
  retryable: boolean;
  start(): void;
  cancel(): void;
  dismiss(): void;
}

export function useMachineExportAction(machineId: string): MachineExportAction {
  const { state, run, cancel } = useMachineExport(machineId);
  const { feedback, retryable, show, setRetryable, begin, finish, dismiss } =
    useTransferFeedbackSlot();

  const start = useCallback(() => {
    if (!begin()) return;
    void run()
      // fallow-ignore-next-line complexity
      .then((outcome) => {
        if (outcome.ok) {
          if (outcome.empty) {
            show('info', MACHINE_EMPTY_COPY);
            return;
          }
          const success = machineExportSuccess({
            fileName: outcome.fileName,
            chatroomCount: outcome.chatroomCount,
            omitted: outcome.omitted,
          });
          show('success', success.message, { items: success.items });
          return;
        }
        if (outcome.cancelled) {
          show('info', EXPORT_CANCELLED_COPY);
          return;
        }
        const copy = machineExportFailure(outcome.failure, outcome.failed, outcome.total);
        show(
          'error',
          copy.message,
          copy.items ? { title: copy.title, items: copy.items } : { title: copy.title }
        );
        setRetryable(copy.retryable);
      })
      .finally(finish);
  }, [begin, finish, run, setRetryable, show]);

  return { phase: state, feedback, retryable, start, cancel, dismiss };
}
