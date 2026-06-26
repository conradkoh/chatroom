// Context
/**
 * @see ./ATTACHMENTS_GUIDE.md — end-to-end guide for implementing message attachments
 */
export {
  AttachmentsProvider,
  useAttachments,
  useTaskAttachments,
  useBacklogAttachments,
  useMessageAttachments,
  useSnippetAttachments,
} from './context/AttachmentsContext';

// Shared read-only
export { MessageAttachmentChips } from './shared/MessageAttachmentChips';
export { countMessageAttachments } from './shared/messageAttachmentUtils';

// Per-type chips (public)
export { AttachedTaskChip } from './task/AttachedTaskChip';
export { AttachedBacklogItemChip } from './backlog/AttachedBacklogItemChip';
export { AttachedMessageChip } from './message/AttachedMessageChip';
export { AttachedSnippetChip } from './snippet/AttachedSnippetChip';

// Snippet compose helpers
export { renderInlineReference } from './snippet/explorerSelectionAttachment';
export {
  buildExplorerSelectionPrefill,
  dispatchComposerPrefill,
  subscribeComposerPrefill,
  PREFILL_TOAST_MESSAGE,
} from './snippet/composerPrefill';
