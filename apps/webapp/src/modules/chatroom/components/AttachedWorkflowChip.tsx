'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { GitBranch } from 'lucide-react';
import React, { useState } from 'react';

import { WorkflowVisualizer } from './WorkflowVisualizer';

interface AttachedWorkflowChipProps {
  chatroomId: Id<'chatroom_rooms'>;
  workflowId: Id<'chatroom_workflows'>;
  workflowKey: string;
  status: string;
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'draft':
      return 'text-chatroom-text-muted';
    case 'active':
      return 'text-blue-500 dark:text-blue-400';
    case 'completed':
      return 'text-green-500 dark:text-green-400';
    case 'cancelled':
      return 'text-red-500 dark:text-red-400';
    default:
      return 'text-chatroom-text-muted';
  }
}

export function AttachedWorkflowChip({
  chatroomId,
  workflowId,
  workflowKey,
  status,
}: AttachedWorkflowChipProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1.5 px-2 py-1 bg-chatroom-bg-tertiary border border-chatroom-border text-xs hover:border-chatroom-border-strong transition-colors cursor-pointer"
      >
        <GitBranch size={12} className={getStatusColor(status)} />
        <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-secondary">
          {workflowKey}
        </span>
        <span className={`text-[10px] ${getStatusColor(status)}`}>({status})</span>
      </button>
      <WorkflowVisualizer
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        chatroomId={chatroomId}
        workflowId={workflowId}
      />
    </>
  );
}
