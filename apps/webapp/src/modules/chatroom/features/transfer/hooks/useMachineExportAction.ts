'use client';

import { useCallback, useRef, useState } from 'react';

import { useMachineExport, type MachineExportState } from './useMachineExport';
import {
  EXPORT_CANCELLED_COPY,
  MACHINE_EMPTY_COPY,
  machineExportFailure,
  machineExportSuccess,
} from '../lib/transferCopy';

import type { Feedback } from '@/components/inline-feedback';
import { useFeedback } from '@/hooks/useFeedback';

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
  const { feedback, show, clear } = useFeedback();
  const [retryable, setRetryable] = useState(false);
  const inFlight = useRef(false);

  const start = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    clear();
    setRetryable(false);
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
      .finally(() => {
        inFlight.current = false;
      });
  }, [clear, run, setRetryable, show]);

  const dismiss = useCallback(() => {
    clear();
    setRetryable(false);
  }, [clear]);

  return { phase: state, feedback, retryable, start, cancel, dismiss };
}
