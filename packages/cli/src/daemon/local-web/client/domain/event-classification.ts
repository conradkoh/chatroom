export type EventClassification = 'info' | 'success' | 'warning' | 'error' | 'muted' | 'purple';
export type EventClassificationStyle = { badge: string };
export const EVENT_CLASSIFICATION_STYLES: Record<EventClassification, EventClassificationStyle> = {
  info: { badge: 'bg-chatroom-status-info/15 text-chatroom-status-info' },
  success: { badge: 'bg-chatroom-status-success/15 text-chatroom-status-success' },
  warning: { badge: 'bg-chatroom-status-warning/15 text-chatroom-status-warning' },
  error: { badge: 'bg-chatroom-status-error/15 text-chatroom-status-error' },
  muted: { badge: 'bg-chatroom-text-muted/15 text-chatroom-text-muted' },
  purple: { badge: 'bg-chatroom-status-purple/15 text-chatroom-status-purple' },
};
export function getClassificationStyle(classification: EventClassification) {
  return EVENT_CLASSIFICATION_STYLES[classification];
}
