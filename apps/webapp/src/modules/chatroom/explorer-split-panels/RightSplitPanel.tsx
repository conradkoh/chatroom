'use client';

/**
 * RightSplitPanel — the right side of the explorer-split view.
 *
 * Contains a header with a mode dropdown that switches between:
 *   • Messages (MessageFeed + SendForm)
 *   • Direct Harness (session browser/composer)
 *
 * Mode is persisted per chatroom via useExplorerSplitPanelMode.
 * Only available in the explorer-split view (md+ screens).
 */

import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../direct-harness/components/ui/select';
import { DirectHarnessPanel } from './DirectHarnessPanel';
import { MessagesPanel, type MessagesPanelProps } from './MessagesPanel';
import {
  useExplorerSplitPanelMode,
  type ExplorerSplitPanelMode,
} from './useExplorerSplitPanelMode';

// ─── Props ────────────────────────────────────────────────────────────────────

// Props forwarded to MessagesPanel (all except chatroomId which is in RightSplitPanelProps)
type MessagesPanelOwnProps = Omit<MessagesPanelProps, 'chatroomId'>;

export interface RightSplitPanelProps {
  chatroomId: Id<'chatroom_rooms'>;
  messagesPanelProps: MessagesPanelOwnProps;
}

// ─── Mode labels ──────────────────────────────────────────────────────────────

const MODE_LABELS: Record<ExplorerSplitPanelMode, string> = {
  messages: 'Messages',
  'direct-harness': 'Direct Harness',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function RightSplitPanel({ chatroomId, messagesPanelProps }: RightSplitPanelProps) {
  const [mode, setMode] = useExplorerSplitPanelMode(chatroomId);

  return (
    <div className="flex flex-col min-h-0 overflow-hidden flex-1">
      {/* Header: mode dropdown */}
      <div className="shrink-0 h-8 border-b border-chatroom-border flex items-center justify-end px-2">
        <Select value={mode} onValueChange={(val) => setMode(val as ExplorerSplitPanelMode)}>
          <SelectTrigger className="h-6 text-[10px] w-36 px-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {(Object.keys(MODE_LABELS) as ExplorerSplitPanelMode[]).map((m) => (
              <SelectItem key={m} value={m} className="text-xs">
                {MODE_LABELS[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Body: panel content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {mode === 'messages' ? (
          <MessagesPanel chatroomId={chatroomId as string} {...messagesPanelProps} />
        ) : (
          <DirectHarnessPanel chatroomId={chatroomId} />
        )}
      </div>
    </div>
  );
}
