'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { FileText, Loader2, ExternalLink } from 'lucide-react';
import React, { useState, useCallback } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { fullMarkdownComponents } from './markdown-utils';

import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
} from '@/components/ui/fixed-modal';

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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3: Extensible viewer registry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Renderer registry - extensible pattern for different artifact types.
 * To add support for a new mime type, create a new viewer component and add
 * an entry here. No other changes needed.
 */
type ArtifactContentRenderer = React.FC<{ artifact: ArtifactFull }>;

/**
 * Markdown artifact viewer
 */
function MarkdownArtifactViewer({ artifact }: { artifact: ArtifactFull }) {
  return (
    <div className="prose dark:prose-invert prose-sm max-w-none text-chatroom-text-primary">
      <Markdown remarkPlugins={[remarkGfm]} components={fullMarkdownComponents}>
        {artifact.content}
      </Markdown>
    </div>
  );
}

/**
 * Fallback artifact viewer for unknown mime types — renders raw text
 */
function FallbackArtifactViewer({ artifact }: { artifact: ArtifactFull }) {
  return (
    <pre className="text-xs text-chatroom-text-primary whitespace-pre-wrap break-words font-mono bg-chatroom-bg-tertiary border border-chatroom-border p-3 overflow-x-auto">
      {artifact.content}
    </pre>
  );
}

const artifactRenderers: Record<string, ArtifactContentRenderer> = {
  'text/markdown': MarkdownArtifactViewer,
  // Add more renderers here to support additional mime types:
  // 'text/plain': PlainTextViewer,
  // 'application/json': JsonViewer,
  // 'image/png': ImageViewer,
};

/**
 * Get the appropriate renderer for an artifact's mime type.
 * Falls back to FallbackArtifactViewer for unknown types.
 */
function getRenderer(mimeType?: string): ArtifactContentRenderer {
  if (mimeType && artifactRenderers[mimeType]) {
    return artifactRenderers[mimeType];
  }
  return FallbackArtifactViewer;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: Artifact detail modal (slide-in panel)
// ─────────────────────────────────────────────────────────────────────────────

interface ArtifactDetailModalProps {
  isOpen: boolean;
  artifact: ArtifactMeta | null;
  onClose: () => void;
}

function ArtifactDetailModal({ isOpen, artifact, onClose }: ArtifactDetailModalProps) {
  if (!artifact) return null;

  return (
    <FixedModal isOpen={isOpen} onClose={onClose} maxWidth="max-w-4xl" className="sm:h-[80vh]">
      <FixedModalContent>
        <FixedModalHeader onClose={onClose}>
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={14} className="flex-shrink-0 text-chatroom-status-info" />
            <span className="text-sm font-bold text-chatroom-text-primary truncate">
              {artifact.filename}
            </span>
            {artifact.mimeType && (
              <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-chatroom-bg-tertiary text-chatroom-text-muted border border-chatroom-border flex-shrink-0">
                {artifact.mimeType}
              </span>
            )}
          </div>
        </FixedModalHeader>

        {/* Description */}
        {artifact.description && (
          <div className="px-4 py-2 border-b border-chatroom-border bg-chatroom-bg-secondary flex-shrink-0">
            <p className="text-xs text-chatroom-text-muted">{artifact.description}</p>
          </div>
        )}

        <FixedModalBody className="overscroll-contain p-6">
          <ArtifactContent artifactId={artifact._id} mimeType={artifact.mimeType} />
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Artifact content loader
// ─────────────────────────────────────────────────────────────────────────────

interface ArtifactContentProps {
  artifactId: string;
  mimeType?: string;
}

function ArtifactContent({ artifactId, mimeType }: ArtifactContentProps) {
  const artifact = useSessionQuery(api.artifacts.get, {
    artifactId: artifactId as Id<'chatroom_artifacts'>,
  }) as ArtifactFull | null | undefined;

  const openInNewWindow = useCallback(() => {
    if (!artifact) return;
    const blob = new Blob([artifact.content], { type: mimeType || 'text/plain' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    // Clean up the blob URL after a delay to allow the new window to load
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, [artifact, mimeType]);

  if (artifact === undefined) {
    return (
      <div className="flex items-center justify-center gap-2 text-chatroom-text-muted py-8">
        <Loader2 size={14} className="animate-spin" />
        <span className="text-xs">Loading artifact...</span>
      </div>
    );
  }

  if (artifact === null) {
    return (
      <div className="text-center text-xs text-chatroom-status-error py-8">Artifact not found</div>
    );
  }

  const Renderer = getRenderer(mimeType);
  return (
    <div>
      <div className="flex justify-end mb-2">
        <button
          onClick={openInNewWindow}
          title="Open in new window"
          className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium text-chatroom-text-muted hover:text-chatroom-text-primary border border-chatroom-border hover:bg-chatroom-bg-hover transition-colors"
        >
          <ExternalLink size={12} />
          Open in new window
        </button>
      </div>
      <Renderer artifact={artifact} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: Compact inline chip — click opens modal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Artifact chip — compact inline pill that opens a detail modal on click
 */
interface ArtifactChipProps {
  artifact: ArtifactMeta;
}

export function ArtifactChip({ artifact }: ArtifactChipProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const openModal = useCallback(() => setIsModalOpen(true), []);
  const closeModal = useCallback(() => setIsModalOpen(false), []);

  return (
    <>
      <button
        onClick={openModal}
        className="inline-flex items-center gap-2 px-3 py-2 border border-chatroom-border bg-chatroom-bg-tertiary hover:bg-chatroom-accent-subtle transition-colors text-left"
        title={artifact.description}
      >
        <FileText size={14} className="flex-shrink-0 text-chatroom-status-info" />
        <span className="text-sm font-medium text-chatroom-text-primary">{artifact.filename}</span>
      </button>

      <ArtifactDetailModal isOpen={isModalOpen} artifact={artifact} onClose={closeModal} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Attached artifacts section for messages
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Renders attached artifact chips inline, wrapping as needed
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
      <div className="flex flex-wrap gap-2">
        {artifacts.map((artifact) => (
          <ArtifactChip key={artifact._id} artifact={artifact} />
        ))}
      </div>
    </div>
  );
}
