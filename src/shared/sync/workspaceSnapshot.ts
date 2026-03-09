import type {
  SharedConversationImportWarning,
  SharedConversationRefreshRequest,
} from '../refresh/sharedConversationRefresh';

export const WORKSPACE_SNAPSHOT_SCHEMA_VERSION = 1;

export type WorkspaceSnapshotMessageSource = {
  attribution?: string;
  description?: string;
  iconUrl?: string;
  publisher?: string;
  title: string;
  url: string;
};

export type WorkspaceSnapshotMessage = {
  id: string;
  role: 'assistant' | 'user';
  sources: WorkspaceSnapshotMessageSource[];
  text: string;
  timestamp: string;
};

export type WorkspaceSnapshotConversation = {
  fetchedAt?: string;
  id: string;
  importOrigin?: 'chat-url';
  importWarning?: SharedConversationImportWarning;
  isSharedImport?: boolean;
  messages: WorkspaceSnapshotMessage[];
  projectSyncStatus?: 'viewer-created';
  refreshRequest?: SharedConversationRefreshRequest;
  sourceUrl?: string;
  summary: string;
  title: string;
  updatedAt: string;
};

export type WorkspaceSnapshotConversationNode = {
  conversationId: string;
  id: string;
  meta: WorkspaceSnapshotNodeMeta;
  type: 'conversation';
};

export type WorkspaceSnapshotNodeMeta = {
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceSnapshotFolderSource = {
  kind: 'project';
  projectUrl: string;
};

export type WorkspaceSnapshotFolderNode = {
  children: WorkspaceSnapshotNode[];
  id: string;
  meta: WorkspaceSnapshotNodeMeta;
  name: string;
  source?: WorkspaceSnapshotFolderSource;
  sortMode?: 'asc' | 'desc' | 'none';
  type: 'folder';
};

export type WorkspaceSnapshotNode =
  | WorkspaceSnapshotConversationNode
  | WorkspaceSnapshotFolderNode;

export type WorkspaceSnapshot = {
  activeConversationId: string;
  conversations: WorkspaceSnapshotConversation[];
  expandedFolderState: Record<string, boolean>;
  savedAt: string;
  schemaVersion: typeof WORKSPACE_SNAPSHOT_SCHEMA_VERSION;
  workspaceTree: WorkspaceSnapshotNode[];
};
