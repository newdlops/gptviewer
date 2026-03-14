import type {
  SharedConversationImport,
  SharedConversationMessage,
} from '../../../shared/refresh/sharedConversationRefresh';
import type { ChatGptConversationNetworkRecord } from '../../services/sharedConversationRefresh/chatgpt/chatGptConversationNetworkMonitor';

export type ConversationMappingNode = {
  message?: {
    author?: { role?: string; name?: string | null };
    channel?: string | null;
    create_time?: number | null;
    content?: {
      content_type?: string;
      parts?: unknown[];
    };
    metadata?: Record<string, unknown>;
    recipient?: string | null;
    status?: string;
  };
  parent?: string | null;
};

export type MappingConversation = {
  current_node?: string;
  mapping?: Record<string, ConversationMappingNode>;
  title?: string;
};

export type ConversationCandidate = Omit<
  SharedConversationImport,
  'fetchedAt' | 'refreshRequest'
>;

export type RecordConversationCandidate = {
  conversation: ConversationCandidate;
  parser: 'json' | 'rsc' | 'html';
  record: ChatGptConversationNetworkRecord;
  score: number;
};

export type ReportMessageCandidate = {
  reportMessage: Record<string, unknown>;
  title: string | null;
};

export type MappingNodeDescriptor = {
  nodeId: string;
  isDeepResearchPlaceholder: boolean;
  renderedMessage: SharedConversationMessage | null;
  reportAssistantMessages: SharedConversationMessage[];
};
