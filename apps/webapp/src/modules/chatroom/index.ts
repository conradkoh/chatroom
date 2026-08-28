/**
 * Chatroom Module
 *
 * Multi-agent chatroom collaboration system components.
 */

// Main dashboard
export { ChatroomDashboard } from './ChatroomDashboard';

// Components
export { AgentPanel } from './components/AgentPanel';
export { ChatroomSelector } from './components/ChatroomSelector';
export { ChatroomSidebar } from './components/ChatroomSidebar';
export { CopyButton } from './components/CopyButton';
export { CreateChatroomForm } from './components/CreateChatroomForm';
export { ErrorBoundary } from './components/ErrorBoundary';
export { PromptModal } from './components/PromptModal';
export { MessageInput } from './components/MessageInput';
export { WorkingIndicator } from './components/WorkingIndicator';

// Context
export {
  ChatroomListingProvider,
  useChatroomListing,
  type ChatroomWithStatus,
} from './context/ChatroomListingContext';
