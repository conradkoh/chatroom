'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { FileText, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import React, { useState, useCallback } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { fullMarkdownComponents } from './markdown-utils';

/**
 * Artifact metadata passed to renderers
 */
export interface ArtifactMeta {
  _id: string;
  filename: string;
  description?: string;
  mimeType?: string;
}

/**
 * Full artifact data including content
 */
interface ArtifactFull extends ArtifactMeta {
  content: string;
}

/**
 * Renderer registry - extensible pattern for different artifact types
 * Add new renderers here to support additional mime types
 */
type ArtifactContentRenderer = React.FC<{ artifact: ArtifactFull }>;

const artifactRenderers: Record<string, ArtifactContentRenderer> = {
  'text/markdown': MarkdownArtifactRenderer,
  // Add more renderers here as needed:
  // 'text/plain': PlainTextRenderer,
  // 'application/json': JsonRenderer,
  // 'image/png': ImageRenderer,
};

/**
 * Get the appropriate renderer for an artifact's mime type
 */
function getRenderer(mimeType?: string): ArtifactContentRenderer {
  if (mimeType && artifactRenderers[mimeType]) {
    return artifactRenderers[mimeType];
  }
  // Default to markdown renderer for unknown types
  return MarkdownArtifactRenderer;
}

/**
 * Markdown artifact content renderer
 */
function MarkdownArtifactRenderer({ artifact }: { artifact: ArtifactFull }) {
  return (
    <div className="prose dark:prose-invert prose-sm max-w-none text-chatroom-text-primary">
      <Markdown remarkPlugins={[remarkGfm]} components={fullMarkdownComponents}>
        {artifact.content}
      </Markdown>
    </div>
  );
}

/**
 * Artifact chip - compact display for message attachments
 * Shows filename and description, expandable to view content
 */
interface ArtifactChipProps {
  artifact: ArtifactMeta;
}

export function ArtifactChip({ artifact }: ArtifactChipProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  return (
    <div className="border border-chatroom-border bg-chatroom-bg-tertiary overflow-hidden">
      {/* Chip header - always visible */}
      <button
        onClick={toggleExpand}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-chatroom-accent-subtle transition-colors text-left"
      >
        <FileText size={14} className="flex-shrink-0 text-chatroom-status-info" />
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-chatroom-text-primary truncate block">
            {artifact.filename}
          </span>
          {artifact.description && (
            <span className="text-[10px] text-chatroom-text-muted truncate block">
              {artifact.description}
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp size={14} className="flex-shrink-0 text-chatroom-text-muted" />
        ) : (
          <ChevronDown size={14} className="flex-shrink-0 text-chatroom-text-muted" />
        )}
      </button>

      {/* Expanded content */}
      {isExpanded && <ArtifactContent artifactId={artifact._id} mimeType={artifact.mimeType} />}
    </div>
  );
}

/**
 * Artifact content loader - fetches and renders artifact content
 */
interface ArtifactContentProps {
  artifactId: string;
  mimeType?: string;
}

function ArtifactContent({ artifactId, mimeType }: ArtifactContentProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatroomApi = api as any;

  const artifact = useSessionQuery(chatroomApi.artifacts.get, {
    artifactId: artifactId as Id<'chatroom_artifacts'>,
  }) as ArtifactFull | null | undefined;

  if (artifact === undefined) {
    return (
      <div className="px-3 py-4 flex items-center justify-center gap-2 text-chatroom-text-muted">
        <Loader2 size={14} className="animate-spin" />
        <span className="text-xs">Loading artifact...</span>
      </div>
    );
  }

  if (artifact === null) {
    return (
      <div className="px-3 py-4 text-center text-xs text-chatroom-status-error">
        Artifact not found
      </div>
    );
  }

  const Renderer = getRenderer(mimeType);

  return (
    <div className="border-t border-chatroom-border px-3 py-3 max-h-96 overflow-y-auto">
      <Renderer artifact={artifact} />
    </div>
  );
}

/**
 * Attached artifacts section for messages
 * Renders a list of artifact chips
 */
interface AttachedArtifactsProps {
  artifacts: ArtifactMeta[];
}

export function AttachedArtifacts({ artifacts }: AttachedArtifactsProps) {
  if (!artifacts || artifacts.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-chatroom-border">
      <div className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted mb-2 flex items-center gap-1">
        <FileText size={10} />
        Attached Artifacts ({artifacts.length})
      </div>
      <div className="space-y-2">
        {artifacts.map((artifact) => (
          <ArtifactChip key={artifact._id} artifact={artifact} />
        ))}
      </div>
    </div>
  );
}
