'use client';

/**
 * SkillsTab — Manage skill customizations for a chatroom.
 *
 * Shows the development workflow skill customization with edit/toggle/reset functionality.
 * When no customization exists, the default skill prompt (from the development-workflow skill) is used.
 */

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { DEVELOPMENT_WORKFLOW_CUSTOMIZATION_TYPE } from "@workspace/backend/src/domain/types/skills";
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { ChevronDown, ChevronRight, FileText, Loader2, Pencil, RotateCcw } from 'lucide-react';
import { memo, useCallback, useState } from 'react';

import { SkillEditorModal } from './SkillEditorModal';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

// ─── Types ──────────────────────────────────────────────────────────────

interface SkillsTabProps {
  chatroomId: string;
}

// ─── Default content ────────────────────────────────────────────────────

/**
 * Default content for the `development_workflow` skill.
 *
 * This mirrors `services/backend/src/domain/usecase/skills/modules/development-workflow/index.ts`
 * (PR #405). Kept in sync manually for now — in the future this should be fetched via
 * a backend query so the skill registry remains the single source of truth.
 */
const DEFAULT_DEVELOPMENT_WORKFLOW_CONTENT = `## Development & Release Flow

1. Check if there is an existing minor / patch release. Create a new release branch (e.g. \`release/1.0.1\`) if not yet available.
2. Update the versions in the package.json files in the repo (remember to check for monorepos with multiple packages)
3. Create a new PR from the release branch to the repo's default branch
4. Create a new feature branch from the release branch
5. Work on the feature and raise a PR to the release branch
`;

// ─── Main Component ─────────────────────────────────────────────────────

export const SkillsTab = memo(function SkillsTab({ chatroomId }: SkillsTabProps) {
  const typedChatroomId = chatroomId as Id<'chatroom_rooms'>;
  const customizationType = DEVELOPMENT_WORKFLOW_CUSTOMIZATION_TYPE;

  const customization = useSessionQuery(api.chatroomSkillCustomizations.getForChatroom, {
    chatroomId: typedChatroomId,
    type: customizationType,
  });

  const createCustomization = useSessionMutation(api.chatroomSkillCustomizations.create);
  const toggleCustomization = useSessionMutation(api.chatroomSkillCustomizations.toggle);
  const removeCustomization = useSessionMutation(api.chatroomSkillCustomizations.remove);

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isDefaultExpanded, setIsDefaultExpanded] = useState(false);

  const handleOverride = useCallback(async () => {
    setIsCreating(true);
    try {
      await createCustomization({
        chatroomId: typedChatroomId,
        type: customizationType,
        name: 'Development Workflow',
        content: DEFAULT_DEVELOPMENT_WORKFLOW_CONTENT,
      });
      setIsEditorOpen(true);
    } finally {
      setIsCreating(false);
    }
  }, [createCustomization, typedChatroomId, customizationType]);

  const handleToggle = useCallback(async () => {
    if (!customization) return;
    await toggleCustomization({
      chatroomId: typedChatroomId,
      customizationId: customization._id,
    });
  }, [toggleCustomization, typedChatroomId, customization]);

  const handleReset = useCallback(async () => {
    if (!customization) return;
    await removeCustomization({
      chatroomId: typedChatroomId,
      customizationId: customization._id,
    });
  }, [removeCustomization, typedChatroomId, customization]);

  // Loading state
  if (customization === undefined) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading skills…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">Skills</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Customize skills for this chatroom. A customization replaces the skill's default system
          prompt when the skill is activated.
        </p>
      </div>

      {/* Development Workflow Card */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-md bg-blue-50 p-2 dark:bg-blue-950/20">
              <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h4 className="text-sm font-medium text-foreground">Development Workflow</h4>
              {customization === null ? (
                <p className="mt-0.5 text-xs text-muted-foreground">Using: Default skill prompt</p>
              ) : (
                <div className="mt-0.5 space-y-0.5">
                  <p className="text-xs text-muted-foreground">
                    Customized{' '}
                    <span
                      className={
                        customization.isEnabled
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-muted-foreground'
                      }
                    >
                      ({customization.isEnabled ? 'Active' : 'Disabled'})
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Last edited: {new Date(customization.updatedAt).toLocaleDateString()}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {customization === null ? (
              <Button
                variant="default"
                size="sm"
                onClick={handleOverride}
                disabled={isCreating}
                className="text-xs"
              >
                {isCreating ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Pencil className="mr-1 h-3 w-3" />
                )}
                Customize
              </Button>
            ) : (
              <>
                <Switch
                  checked={customization.isEnabled}
                  onCheckedChange={handleToggle}
                  aria-label="Toggle skill customization"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditorOpen(true)}
                  className="text-xs"
                >
                  <Pencil className="mr-1 h-3 w-3" />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReset}
                  className="text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                >
                  <RotateCcw className="mr-1 h-3 w-3" />
                  Reset
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Default skill prompt preview in empty state */}
        {customization === null && (
          <div className="mt-3 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setIsDefaultExpanded((v) => !v)}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {isDefaultExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              View default skill prompt
            </button>
            {isDefaultExpanded && (
              <div className="mt-2 max-h-64 overflow-auto rounded-md border border-border bg-muted/50 p-3">
                <pre className="whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
                  {DEFAULT_DEVELOPMENT_WORKFLOW_CONTENT}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Editor Modal */}
      {customization && (
        <SkillEditorModal
          isOpen={isEditorOpen}
          onClose={() => setIsEditorOpen(false)}
          chatroomId={chatroomId}
          customizationId={customization._id}
          initialContent={customization.content}
          skillName={customization.name}
        />
      )}
    </div>
  );
});
