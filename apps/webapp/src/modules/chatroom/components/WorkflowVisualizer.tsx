'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import React, { useMemo, useState } from 'react';

import { MermaidBlock } from './MermaidBlock';
import { buildWorkflowChartWithStatus } from '../utils/workflowMermaid';

import {
  FixedModal,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
  FixedModalBody,
} from '@/components/ui/fixed-modal';

// ─── Types ──────────────────────────────────────────────────────────

interface WorkflowVisualizerProps {
  isOpen: boolean;
  onClose: () => void;
  chatroomId: Id<'chatroom_rooms'>;
  workflowId: Id<'chatroom_workflows'>;
}

interface StepData {
  stepKey: string;
  description: string;
  status: string;
  assigneeRole?: string;
  dependsOn: string[];
  order: number;
  specification?: {
    goal: string;
    requirements: string;
    warnings?: string;
    skills?: string;
  } | null;
  completedAt?: number | null;
  cancelledAt?: number | null;
  cancelReason?: string | null;
}

/** Workflow status → badge styling */
function getWorkflowStatusBadge(status: string) {
  switch (status) {
    case 'draft':
      return {
        label: 'Draft',
        classes:
          'bg-chatroom-bg-tertiary text-chatroom-text-muted',
      };
    case 'active':
      return {
        label: 'Active',
        classes:
          'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
      };
    case 'completed':
      return {
        label: 'Completed',
        classes:
          'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
      };
    case 'cancelled':
      return {
        label: 'Cancelled',
        classes:
          'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
      };
    default:
      return { label: status, classes: 'bg-chatroom-bg-tertiary' };
  }
}

/** Step status → emoji */
function getStepStatusEmoji(status: string): string {
  switch (status) {
    case 'completed':
      return '✅';
    case 'in_progress':
      return '🔄';
    case 'cancelled':
      return '❌';
    default:
      return '⏳';
  }
}

/** Step status → badge styling */
function getStepStatusBadge(status: string) {
  switch (status) {
    case 'pending':
      return {
        label: 'Pending',
        classes:
          'bg-chatroom-text-muted/15 text-chatroom-text-muted',
      };
    case 'in_progress':
      return {
        label: 'In Progress',
        classes:
          'bg-chatroom-status-info/15 text-chatroom-status-info',
      };
    case 'completed':
      return {
        label: 'Completed',
        classes:
          'bg-chatroom-status-success/15 text-chatroom-status-success',
      };
    case 'cancelled':
      return {
        label: 'Cancelled',
        classes:
          'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
      };
    default:
      return { label: status, classes: 'bg-chatroom-text-muted/15 text-chatroom-text-muted' };
  }
}

// ─── Step Card ──────────────────────────────────────────────────────

function StepCard({
  step,
  isExpanded,
  onToggle,
}: {
  step: StepData;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const statusBadge = getStepStatusBadge(step.status);
  const emoji = getStepStatusEmoji(step.status);

  return (
    <div className="border border-chatroom-border rounded-none overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-chatroom-bg-hover transition-colors"
      >
        {isExpanded ? (
          <ChevronDown size={14} className="text-chatroom-text-muted flex-shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-chatroom-text-muted flex-shrink-0" />
        )}
        <span className="text-sm">{emoji}</span>
        <span className="text-sm font-semibold text-chatroom-text-primary truncate">
          {step.stepKey}
        </span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${statusBadge.classes}`}>
          {statusBadge.label}
        </span>
        {step.assigneeRole && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-chatroom-bg-tertiary text-chatroom-text-muted font-medium flex-shrink-0">
            {step.assigneeRole}
          </span>
        )}
      </button>

      {/* Expanded details */}
      {isExpanded && (
        <div className="px-3 pb-3 border-t border-chatroom-border bg-chatroom-bg-surface">
          {/* Description */}
          <div className="mt-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
              Description
            </span>
            <p className="text-xs text-chatroom-text-secondary mt-0.5">{step.description}</p>
          </div>

          {/* Dependencies */}
          {step.dependsOn.length > 0 && (
            <div className="mt-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
                Dependencies
              </span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {step.dependsOn.map((dep) => (
                  <span
                    key={dep}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-chatroom-bg-tertiary text-chatroom-text-muted font-mono"
                  >
                    {dep}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Specification details */}
          {step.specification && (
            <>
              <div className="mt-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
                  Goal
                </span>
                <p className="text-xs text-chatroom-text-secondary mt-0.5 whitespace-pre-wrap">
                  {step.specification.goal}
                </p>
              </div>
              <div className="mt-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
                  Requirements
                </span>
                <p className="text-xs text-chatroom-text-secondary mt-0.5 whitespace-pre-wrap">
                  {step.specification.requirements}
                </p>
              </div>
              {step.specification.warnings && (
                <div className="mt-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-yellow-600 dark:text-yellow-400">
                    Warnings
                  </span>
                  <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-0.5 whitespace-pre-wrap">
                    {step.specification.warnings}
                  </p>
                </div>
              )}
              {step.specification.skills && (
                <div className="mt-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
                    Skills
                  </span>
                  <p className="text-xs text-chatroom-text-secondary mt-0.5 whitespace-pre-wrap">
                    {step.specification.skills}
                  </p>
                </div>
              )}
            </>
          )}

          {/* Timestamps */}
          {step.completedAt && (
            <div className="mt-2 text-[10px] text-chatroom-text-muted">
              Completed: {new Date(step.completedAt).toLocaleString()}
            </div>
          )}
          {step.cancelledAt && (
            <div className="mt-2 text-[10px] text-red-600 dark:text-red-400">
              Cancelled: {new Date(step.cancelledAt).toLocaleString()}
              {step.cancelReason && ` — ${step.cancelReason}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export function WorkflowVisualizer({
  isOpen,
  onClose,
  chatroomId,
  workflowId,
}: WorkflowVisualizerProps) {
  const data = useSessionQuery(
    api.workflows.getWorkflowDetail,
    isOpen ? { chatroomId, workflowId } : 'skip'
  );

  const [expandedStepKey, setExpandedStepKey] = useState<string | null>(null);

  const mermaidChart = useMemo(() => {
    if (!data?.steps || data.steps.length === 0) return null;
    return buildWorkflowChartWithStatus(data.steps);
  }, [data?.steps]);

  const statusBadge = data ? getWorkflowStatusBadge(data.workflow.status) : null;

  const handleToggleStep = (stepKey: string) => {
    setExpandedStepKey((prev) => (prev === stepKey ? null : stepKey));
  };

  return (
    <FixedModal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="max-w-5xl"
      className="sm:!h-[85vh]"
    >
      <FixedModalContent>
        <FixedModalHeader onClose={onClose}>
          <FixedModalTitle>
            <div className="flex items-center gap-2">
              <span>Workflow: {data?.workflow.workflowKey ?? '...'}</span>
              {statusBadge && (
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-medium ${statusBadge.classes}`}
                >
                  {statusBadge.label}
                </span>
              )}
            </div>
          </FixedModalTitle>
        </FixedModalHeader>

        <FixedModalBody className="p-0 overflow-hidden">
          {!data ? (
            /* Loading state */
            <div className="flex items-center justify-center h-full">
              <Loader2 size={24} className="animate-spin text-chatroom-text-muted" />
              <span className="ml-2 text-sm text-chatroom-text-muted">Loading workflow...</span>
            </div>
          ) : (
            /* Split panel layout */
            <div className="flex h-full">
              {/* Left Panel — Mermaid DAG (60%) */}
              <div className="w-[60%] border-r border-chatroom-border overflow-auto p-4">
                {mermaidChart ? (
                  <MermaidBlock chart={mermaidChart} />
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-chatroom-text-muted">
                    No steps to visualize
                  </div>
                )}
              </div>

              {/* Right Panel — Step List (40%) */}
              <div className="w-[40%] overflow-y-auto p-3 space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted mb-2">
                  Steps ({data.steps.length})
                </div>
                {data.steps.map((step) => (
                  <StepCard
                    key={step.stepKey}
                    step={step}
                    isExpanded={expandedStepKey === step.stepKey}
                    onToggle={() => handleToggleStep(step.stepKey)}
                  />
                ))}
              </div>
            </div>
          )}
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
}
