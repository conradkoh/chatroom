'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import React from 'react';

import { QueuedMessageItem } from './QueuedMessageItem';
import type { Message } from '../../types/message';

import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
} from '@/components/ui/fixed-modal';

export interface QueuedMessagesModalProps {
  chatroomId: Id<'chatroom_rooms'>;
  messages: Message[];
  onClose: () => void;
  onPromote: (queuedMessageId: string) => Promise<void>;
  onDelete: (queuedMessageId: string) => Promise<void>;
}

/** Full list of queued messages — supports edit/promote/delete on every item. */
export function QueuedMessagesModal({
  chatroomId,
  messages,
  onClose,
  onPromote,
  onDelete,
}: QueuedMessagesModalProps) {
  return (
    <FixedModal isOpen onClose={onClose} maxWidth="max-w-xl" className="sm:max-h-[70vh]">
      <FixedModalContent>
        <FixedModalHeader onClose={onClose} className="py-4">
          <span className="text-sm font-bold uppercase tracking-wide text-chatroom-text-primary">
            Queued Messages ({messages.length})
          </span>
        </FixedModalHeader>

        <FixedModalBody className="p-0">
          {messages.length === 0 ? (
            <div className="p-8 text-center text-chatroom-text-muted text-sm">
              No queued messages
            </div>
          ) : (
            messages.map((message) => (
              <QueuedMessageItem
                key={message._id}
                chatroomId={chatroomId}
                message={message}
                onPromote={onPromote}
                onDelete={onDelete}
              />
            ))
          )}
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
}
