'use client';

import { useEffect, useMemo } from 'react';

import { EnhancerDiffViewModeToggle } from './EnhancerDiffViewModeToggle';
import { EnhancerSplitDiffView } from './EnhancerSplitDiffView';
import { EnhancerUnifiedDiffView } from './EnhancerUnifiedDiffView';
import { useEnhancerDiffViewMode } from '../hooks/useEnhancerDiffViewMode';
import { buildEnhancerTextDiff } from '../utils/buildEnhancerTextDiff';

import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
} from '@/components/ui/fixed-modal';

export interface EnhancerDiffPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  originalContent: string;
  enhancedContent: string;
}

/**
 * Lazy-loaded enhancer before/after diff panel.
 * Diff is computed only while the panel is open — not optimistically on mount.
 */
export function EnhancerDiffPanel({
  open,
  onOpenChange,
  originalContent,
  enhancedContent,
}: EnhancerDiffPanelProps) {
  const { viewMode, setViewMode, resetViewMode } = useEnhancerDiffViewMode();

  const handleClose = () => onOpenChange(false);

  useEffect(() => {
    if (!open) {
      resetViewMode();
    }
  }, [open, resetViewMode]);

  const diff = useMemo(() => {
    if (!open) return null;
    return buildEnhancerTextDiff(originalContent, enhancedContent);
  }, [open, originalContent, enhancedContent]);

  return (
    <FixedModal isOpen={open} onClose={handleClose} maxWidth="max-w-6xl" className="sm:!h-[85vh]">
      <FixedModalContent>
        <FixedModalHeader onClose={handleClose}>
          <div className="flex w-full items-center justify-between gap-3 pr-1">
            <div className="min-w-0">
              <FixedModalTitle>Enhancement diff</FixedModalTitle>
              <p className="mt-0.5 text-[10px] font-normal normal-case tracking-normal text-chatroom-text-muted">
                Compare the original draft with the enhanced output.
              </p>
            </div>
            <EnhancerDiffViewModeToggle viewMode={viewMode} onViewModeChange={setViewMode} />
          </div>
        </FixedModalHeader>

        <FixedModalBody
          className="flex min-h-0 flex-1 flex-col p-3 sm:p-4"
          data-testid="enhancer-diff-panel-body"
        >
          {diff &&
            (viewMode === 'split' ? (
              <EnhancerSplitDiffView before={diff.split.before} after={diff.split.after} />
            ) : (
              <EnhancerUnifiedDiffView lines={diff.unified} />
            ))}
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
}
