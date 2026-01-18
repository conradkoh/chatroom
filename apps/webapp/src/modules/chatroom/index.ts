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
export { CopyButton } from './components/CopyButton';
export { CreateChatroomForm } from './components/CreateChatroomForm';
export { ErrorBoundary } from './components/ErrorBoundary';
export { FeatureDetailModal } from './components/FeatureDetailModal';
export { MessageFeed } from './components/MessageFeed';
export { PromptModal } from './components/PromptModal';
export { SendForm } from './components/SendForm';
export { SetupChecklist } from './components/SetupChecklist';
export { TeamStatus } from './components/TeamStatus';
export { WorkingIndicator } from './components/WorkingIndicator';

// Context
export {
  ChatroomListingProvider,
  useChatroomListing,
  type ChatroomWithStatus,
  type Agent,
  type TeamReadiness,
} from './context/ChatroomListingContext';

// Prompts
export * from './prompts';
