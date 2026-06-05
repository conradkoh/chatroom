import { Suspense } from 'react';

import { ChatroomPageClient } from './ChatroomPageClient';

import { PageSpinner } from '@/components/ui/spinner';


export default function ChatroomPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <ChatroomPageClient />
    </Suspense>
  );
}
