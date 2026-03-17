'use client';

import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import { formatTimestamp, formatTimestampFull } from '../viewModels/eventStreamViewModel';
import { fullMarkdownComponents, inlineEventProseClassNames } from '../components/markdown-utils';

// ─── Badge Color Types ────────────────────────────────────────────────────────

export type BadgeColor = 'info' | 'success' | 'warning' | 'error' | 'muted' | 'purple';

const badgeColorStyles: Record<BadgeColor, string> = {
  info: 'bg-chatroom-status-info/15 text-chatroom-status-info',
  success: 'bg-chatroom-status-success/15 text-chatroom-status-success',
  warning: 'bg-chatroom-status-warning/15 text-chatroom-status-warning',
  error: 'bg-chatroom-status-error/15 text-chatroom-status-error',
  muted: 'bg-chatroom-text-muted/15 text-chatroom-text-muted',
  purple: 'bg-chatroom-status-purple/15 text-chatroom-status-purple',
};

// ─── Event Row (Cell Renderer) ───────────────────────────────────────────────

export interface EventRowProps {
  type: string;
  badgeText: string;
  badgeColor: BadgeColor;
  primaryInfo: string;
  secondaryInfo?: string;
  timestamp: number;
  isSelected?: boolean;
  onClick?: () => void;
}

/**
 * Reusable event row component for the event list.
 * Renders a compact row with type badge, primary/secondary info, and timestamp.
 */
export const EventRow = memo(function EventRow({
  badgeText,
  badgeColor,
  primaryInfo,
  secondaryInfo,
  timestamp,
  isSelected = false,
  onClick,
}: EventRowProps) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 border-b border-chatroom-border last:border-b-0 transition-colors ${
        onClick ? 'cursor-pointer' : ''
      } ${
        isSelected
          ? 'bg-chatroom-accent/10 border-l-2 border-l-chatroom-accent'
          : 'hover:bg-chatroom-bg-hover'
      }`}
    >
      {/* Type badge */}
      <span
        className={`flex-shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${badgeColorStyles[badgeColor]}`}
      >
        {badgeText}
      </span>
      {/* Primary info (usually role) */}
      <span className="flex-shrink-0 text-[10px] font-medium text-chatroom-text-primary truncate max-w-[100px]">
        {primaryInfo}
      </span>
      {/* Secondary info (optional) */}
      {secondaryInfo && (
        <span className="flex-shrink text-[10px] text-chatroom-text-secondary truncate">
          {secondaryInfo}
        </span>
      )}
      {/* Timestamp — pushed right */}
      <span className="ml-auto flex-shrink-0 text-[10px] text-chatroom-text-muted tabular-nums font-mono">
        {formatTimestamp(timestamp)}
      </span>
    </div>
  );
});

// ─── Event Details (Side Panel) ───────────────────────────────────────────────

export interface EventDetailsProps {
  title: string;
  timestamp: number;
  type: string;
  children: React.ReactNode;
}

/**
 * Container for event details panel.
 * Wraps children with header showing event type and timestamp.
 */
export const EventDetails = memo(function EventDetails({
  title,
  timestamp,
  type,
  children,
}: EventDetailsProps) {
  return (
    <div className="flex flex-col h-full w-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-chatroom-border bg-chatroom-bg-tertiary flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-chatroom-text-primary">{title}</span>
          <span className="text-[10px] text-chatroom-text-muted font-mono">
            {formatTimestampFull(timestamp)}
          </span>
        </div>
        <span className="text-[10px] text-chatroom-text-secondary font-mono">{type}</span>
      </div>
      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto">
        <div className="py-2 w-full">{children}</div>
      </div>
    </div>
  );
});

// ─── Detail Row (Attribute Display) ───────────────────────────────────────────

export interface DetailRowProps {
  label: string;
  value: string;
  mono?: boolean;
}

/**
 * Single row for displaying an attribute in the details panel.
 * Label on the left, value on the right.
 */
export const DetailRow = memo(function DetailRow({ label, value, mono = false }: DetailRowProps) {
  return (
    <div className="flex items-start gap-2 px-4 py-1.5 border-b border-chatroom-border last:border-b-0">
      <span className="text-[10px] font-medium text-chatroom-text-muted uppercase tracking-wide min-w-[80px] flex-shrink-0">
        {label}
      </span>
      <span
        className={`text-[11px] text-chatroom-text-primary break-all ${mono ? 'font-mono text-[10px]' : ''}`}
      >
        {value}
      </span>
    </div>
  );
});

// ─── Markdown Detail Block ───────────────────────────────────────────────────

export interface MarkdownDetailBlockProps {
  label: string;
  content: string;
}

/**
 * Renders a markdown content block in the details panel.
 * Uses react-markdown with GFM and line breaks support.
 */
export const MarkdownDetailBlock = memo(function MarkdownDetailBlock({
  label,
  content,
}: MarkdownDetailBlockProps) {
  return (
    <div className="px-4 py-2 border-b border-chatroom-border last:border-b-0">
      <span className="text-[10px] font-medium text-chatroom-text-muted uppercase tracking-wide">
        {label}
      </span>
      <div className={`mt-1 ${inlineEventProseClassNames}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={fullMarkdownComponents}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
});

// ─── Placeholder for unregistered events ──────────────────────────────────────

export interface PlaceholderEventProps {
  type: string;
  timestamp: number;
  isSelected?: boolean;
  onClick?: () => void;
}

/**
 * Placeholder row for events without registered renderers.
 * Shows basic info with a ghost badge.
 */
export const PlaceholderEventRow = memo(function PlaceholderEventRow({
  type,
  timestamp,
  isSelected = false,
  onClick,
}: PlaceholderEventProps) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 border-b border-chatroom-border last:border-b-0 transition-colors ${
        onClick ? 'cursor-pointer' : ''
      } ${
        isSelected
          ? 'bg-chatroom-accent/10 border-l-2 border-l-chatroom-accent'
          : 'hover:bg-chatroom-bg-hover'
      }`}
    >
      {/* Type badge */}
      <span
        className={`flex-shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${badgeColorStyles.muted}`}
      >
        {type.split('.')[1] ?? type}
      </span>
      {/* Timestamp */}
      <span className="ml-auto text-[10px] text-chatroom-text-muted tabular-nums font-mono">
        {formatTimestamp(timestamp)}
      </span>
    </div>
  );
});

/**
 * Placeholder details for events without registered renderers.
 */
export const PlaceholderEventDetails = memo(function PlaceholderEventDetails({
  type,
  timestamp,
}: PlaceholderEventProps) {
  return (
    <EventDetails title={type} timestamp={timestamp} type={type}>
      <div className="px-4 py-3 text-chatroom-text-muted text-xs">
        No details available for this event type.
      </div>
    </EventDetails>
  );
});