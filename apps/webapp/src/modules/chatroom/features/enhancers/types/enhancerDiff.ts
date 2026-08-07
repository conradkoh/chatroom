export type EnhancerDiffViewMode = 'split' | 'unified';

export type EnhancerDiffLineType = 'addition' | 'deletion' | 'unchanged';

/** A single line in unified diff view. */
export interface EnhancerUnifiedDiffLine {
  type: EnhancerDiffLineType;
  content: string;
}

/** A line in one pane of split diff view. */
export interface EnhancerSplitDiffLine {
  type: EnhancerDiffLineType | 'empty';
  content: string;
  lineNumber?: number;
}

export interface EnhancerSplitDiffPane {
  label: string;
  lines: EnhancerSplitDiffLine[];
}

/** Computed diff between original and enhanced enhancer content. */
export interface EnhancerTextDiff {
  unified: EnhancerUnifiedDiffLine[];
  split: {
    before: EnhancerSplitDiffPane;
    after: EnhancerSplitDiffPane;
  };
}
