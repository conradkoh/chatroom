'use client';

import { useRouter } from 'next/navigation';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChatroomSelector, WorkspaceSelector } from '@/modules/chatroom';

/**
 * Main application page - two-tab view: chatroom listing and workspace listing.
 */
export default function AppPage() {
  const router = useRouter();

  const handleSelectChatroom = (chatroomId: string) => {
    router.push(`/app/chatroom?id=${chatroomId}`);
  };

  return (
    <Tabs defaultValue="chatrooms">
      <div className="chatroom-root bg-chatroom-bg-primary text-chatroom-text-primary border-b-2 border-chatroom-border px-6 py-4">
        <TabsList variant="line">
          <TabsTrigger value="chatrooms">Chatrooms</TabsTrigger>
          <TabsTrigger value="workspaces">Workspaces</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="chatrooms">
        <ChatroomSelector onSelect={handleSelectChatroom} />
      </TabsContent>
      <TabsContent value="workspaces">
        <WorkspaceSelector onSelectChatroom={handleSelectChatroom} />
      </TabsContent>
    </Tabs>
  );
}
