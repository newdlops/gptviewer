import type {
  SharedConversationImportWarning,
  SharedConversationRefreshRequest,
} from '../../shared/refresh/sharedConversationRefresh';

export type ChatRole = 'assistant' | 'user';

export type MessageSource = {
  attribution?: string;
  description?: string;
  iconUrl?: string;
  publisher?: string;
  title: string;
  url: string;
};

export type ImportedConversation = {
  fetchedAt: string;
  importOrigin?: 'chat-url';
  importWarning?: SharedConversationImportWarning;
  messages: Array<{ role: ChatRole; sources: MessageSource[]; text: string }>;
  refreshRequest?: SharedConversationRefreshRequest;
  sourceUrl: string;
  summary: string;
  title: string;
};

export type Message = {
  id: string;
  role: ChatRole;
  sources: MessageSource[];
  text: string;
  timestamp: string;
};

export type Conversation = {
  fetchedAt?: string;
  id: string;
  importOrigin?: 'chat-url';
  importWarning?: SharedConversationImportWarning;
  isSharedImport?: boolean;
  refreshRequest?: SharedConversationRefreshRequest;
  projectSyncStatus?: 'viewer-created';
  title: string;
  summary: string;
  sourceUrl?: string;
  updatedAt: string;
  messages: Message[];
};

export type WorkspaceConversationNode = {
  id: string;
  meta: WorkspaceNodeMeta;
  type: 'conversation';
  conversationId: string;
};

export type WorkspaceNodeMeta = {
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceFolderSource = {
  kind: 'project';
  projectUrl: string;
};

export type WorkspaceFolderSortMode = 'asc' | 'desc' | 'none';

export type WorkspaceFolderNode = {
  id: string;
  meta: WorkspaceNodeMeta;
  name: string;
  source?: WorkspaceFolderSource;
  sortMode?: WorkspaceFolderSortMode;
  type: 'folder';
  children: WorkspaceNode[];
};

export type WorkspaceNode = WorkspaceFolderNode | WorkspaceConversationNode;

export type SourceDrawerState = {
  heading: string;
  messageId: string;
  sources: MessageSource[];
};

export type SourcePreview = {
  description?: string;
  iconHref?: string;
  iconUrl?: string;
  publisher?: string;
  title?: string;
  url: string;
};

export type ThemeMode = 'dark' | 'light';
