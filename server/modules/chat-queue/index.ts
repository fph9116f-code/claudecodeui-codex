// The HTTP surface for a session's queued messages, mounted by the app.
export { default as chatQueueRoutes } from './chat-queue.routes.js';

// The per-session queue dispatcher, started and stopped with the server.
export {
  initializeChatQueueDispatcher,
  closeChatQueueDispatcher,
  dispatchQueuedMessages,
  drainSessionQueue,
  insertQueuedMessageNow,
  steerMessageNow,
  tryInsertQueuedMessageNow,
  canInsertIntoSession,
  triggerChatQueueDrain,
} from './services/chat-queue-dispatcher.service.js';

// Queue operations, also used by the dispatcher's tests.
export {
  chatQueueService,
  setChatQueueDrainTrigger,
  toChatQueueMessage,
} from './services/chat-queue.service.js';
export type {
  ChatQueueMessage,
  ChatQueueSnapshot,
} from './services/chat-queue.service.js';
