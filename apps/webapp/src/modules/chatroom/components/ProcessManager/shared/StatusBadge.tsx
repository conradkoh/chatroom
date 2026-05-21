/**
 * StatusBadge — colored status pill for a command run status.
 * Pure presentational component.
 */

'use client';

import { Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import type { CommandRun } from '../ProcessManager';

interface StatusBadgeProps {
  status: CommandRun['status'];
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const configs = {
    pending: {
      icon: Loader2,
      text: 'Pending',
      color: 'text-yellow-500 dark:text-yellow-400',
      spin: true,
    },
    running: {
      icon: Loader2,
      text: 'Running',
      color: 'text-blue-500 dark:text-blue-400',
      spin: true,
    },
    completed: {
      icon: CheckCircle2,
      text: 'Completed',
      color: 'text-green-500 dark:text-green-400',
      spin: false,
    },
    failed: {
      icon: XCircle,
      text: 'Failed',
      color: 'text-red-500 dark:text-red-400',
      spin: false,
    },
    stopped: {
      icon: AlertTriangle,
      text: 'Stopped',
      color: 'text-orange-500 dark:text-orange-400',
      spin: false,
    },
    killed: {
      icon: AlertTriangle,
      text: 'Replaced',
      color: 'text-orange-500 dark:text-orange-400',
      spin: false,
    },
  };
  const config = configs[status];
  const Icon = config.icon;

  return (
    <span
      className={`flex items-center gap-1 ${config.color} text-xs font-bold uppercase tracking-wider`}
    >
      <Icon size={12} className={config.spin ? 'animate-spin' : ''} />
      {config.text}
    </span>
  );
}
