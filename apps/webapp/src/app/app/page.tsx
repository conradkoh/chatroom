'use client';

import { useRouter, useSearchParams } from 'next/navigation';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChatroomSelector, WorkspaceSelector } from '@/modules/chatroom';

const VALID_TABS = ['workspaces', 'chatrooms'] as const;
type TabId = (typeof VALID_TABS)[number];

function isTabId(value: string | null): value is TabId {
  return value !== null && (VALID_TABS as readonly string[]).includes(value);
}

/**
 * Main application page - two-tab view: workspace listing and chatroom listing.
 * Workspaces is the canonical default tab; Chatrooms is persisted via ?tab=.
 */
export default function AppPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: TabId = isTabId(tabParam) ? tabParam : 'workspaces';

  const handleTabChange = (tab: string) => {
    const params = new URLSearchParams(searchParams.toString());
    const tabId = String(tab);
    if (tabId === 'workspaces') params.delete('tab');
    else params.set('tab', tabId);
    router.replace(`/app${params.toString() ? `?${params.toString()}` : ''}`);
  };

  const handleSelectChatroom = (chatroomId: string) => {
    router.push(`/app/chatroom?id=${chatroomId}`);
  };

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <div className="chatroom-root bg-chatroom-bg-primary text-chatroom-text-primary px-6 pt-4">
        <TabsList variant="line">
          <TabsTrigger value="workspaces">Workspaces</TabsTrigger>
          <TabsTrigger value="chatrooms">Chatrooms</TabsTrigger>
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
