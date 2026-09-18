'use client';

import type { ReactNode } from 'react';

import { HandoffEnvelopeView } from './timeline/HandoffEnvelopeView';
import { HandoffReportView } from './timeline/HandoffReportView';
import { hasHandoffEnvelope } from '../utils/parseHandoffEnvelope';
import { hasHandoffReport } from '../utils/parseHandoffReport';

export type HandoffStructuredContentVariant = 'timeline' | 'detail';

export interface HandoffStructuredContentProps {
  content: string;
  variant?: HandoffStructuredContentVariant;
  /** Rendered when content is not envelope or report (e.g. Markdown). */
  fallback?: ReactNode;
}

export function HandoffStructuredContent({
  content,
  variant = 'detail',
  fallback = null,
}: HandoffStructuredContentProps) {
  if (hasHandoffEnvelope(content)) {
    return <HandoffEnvelopeView content={content} variant={variant} />;
  }
  if (hasHandoffReport(content)) {
    return <HandoffReportView content={content} variant={variant} />;
  }
  return <>{fallback}</>;
}
