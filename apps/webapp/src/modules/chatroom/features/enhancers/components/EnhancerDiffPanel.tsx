'use client';

import { useEffect, useMemo } from 'react';

import { EnhancerDiffViewModeToggle } from './EnhancerDiffViewModeToggle';
import { EnhancerSplitDiffView } from './EnhancerSplitDiffView';
import { EnhancerUnifiedDiffView } from './EnhancerUnifiedDiffView';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { useEnhancerDiffViewMode } from '../hooks/useEnhancerDiffViewMode';
import { buildEnhancerTextDiff } from '../utils/buildEnhancerTextDiff';

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[min(96vw,64rem)] max-w-none flex-col gap-3">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle>Enhancement diff</DialogTitle>
              <DialogDescription>
                Compare the original draft with the enhanced output.
              </DialogDescription>
            </div>
            <EnhancerDiffViewModeToggle viewMode={viewMode} onViewModeChange={setViewMode} />
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden" data-testid="enhancer-diff-panel-body">
          {diff &&
            (viewMode === 'split' ? (
              <EnhancerSplitDiffView before={diff.split.before} after={diff.split.after} />
            ) : (
              <EnhancerUnifiedDiffView lines={diff.unified} />
            ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
