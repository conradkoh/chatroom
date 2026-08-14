export { ChatroomMarkdownEditor, ChatroomMarkdownEditorShell, chatroomEditorContentClassName, CHATROOM_EDITOR_WRAPPER_CLASS, handleChatroomModEnterCapture } from './chatroom-markdown-editor';

export function isInteractiveClickTarget(target: EventTarget | null): boolean {
  return !!(target as HTMLElement)?.closest?.('button, a, input, textarea, select, label');
}
