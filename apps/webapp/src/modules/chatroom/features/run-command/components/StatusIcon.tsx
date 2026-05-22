/**
 * StatusIcon — lucide-react icon mapped to a command run status.
 * Pure presentational component.
 */

'use client';

import { Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import type { CommandRun } from '../types/run';

interface StatusIconProps {
  status: CommandRun['status'];
}

export function StatusIcon({ status }: StatusIconProps) {
  switch (status) {
    case 'pending':
      return <Loader2 size={12} className="animate-spin text-yellow-500" />;
    case 'running':
      return <Loader2 size={12} className="animate-spin text-blue-500" />;
    case 'completed':
      return <CheckCircle2 size={12} className="text-green-500" />;
    case 'failed':
      return <XCircle size={12} className="text-red-500" />;
    case 'stopped':
      return <AlertTriangle size={12} className="text-orange-500" />;
    case 'killed':
      return <AlertTriangle size={12} className="text-orange-500" />;
  }
}
