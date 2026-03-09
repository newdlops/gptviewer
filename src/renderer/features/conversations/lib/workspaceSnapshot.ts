import {
  WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
  type WorkspaceSnapshot,
} from '../../../../shared/sync/workspaceSnapshot';
import type {
  SharedConversationImportWarning,
  SharedConversationRefreshRequest,
} from '../../../../shared/refresh/sharedConversationRefresh';
import type {
  Conversation,
  Message,
  MessageSource,
  WorkspaceFolderSource,
  WorkspaceFolderSortMode,
  WorkspaceNodeMeta,
  WorkspaceNode,
} from '../../../types/chat';

export type WorkspacePersistenceState = {
  activeConversationId: string;
  conversations: Conversation[];
  expandedFolderState: Record<string, boolean>;
  workspaceTree: WorkspaceNode[];
};

const normalizeMessageSource = (value: unknown): MessageSource | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  const url = typeof record.url === 'string' ? record.url.trim() : '';

  if (!title || !url) {
    return null;
  }

  return {
    attribution:
      typeof record.attribution === 'string' && record.attribution.trim()
        ? record.attribution.trim()
        : undefined,
    description:
      typeof record.description === 'string' && record.description.trim()
        ? record.description.trim()
        : undefined,
    iconUrl:
      typeof record.iconUrl === 'string' && record.iconUrl.trim()
        ? record.iconUrl.trim()
        : undefined,
    publisher:
      typeof record.publisher === 'string' && record.publisher.trim()
        ? record.publisher.trim()
        : undefined,
    title,
    url,
  };
};

const normalizeMessage = (value: unknown): Message | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const role =
    record.role === 'assistant' || record.role === 'user' ? record.role : null;
  const text = typeof record.text === 'string' ? record.text : '';
  const timestamp =
    typeof record.timestamp === 'string' ? record.timestamp.trim() : '';
  const sources = Array.isArray(record.sources)
    ? record.sources
        .map((source) => normalizeMessageSource(source))
        .filter((source): source is MessageSource => !!source)
    : [];

  if (!id || !role || !text.trim()) {
    return null;
  }

  return {
    id,
    role,
    sources,
    text,
    timestamp,
  };
};

const normalizeConversation = (value: unknown): Conversation | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  const summary =
    typeof record.summary === 'string' ? record.summary.trim() : '';
  const updatedAt =
    typeof record.updatedAt === 'string' ? record.updatedAt.trim() : '';
  const messages = Array.isArray(record.messages)
    ? record.messages
        .map((message) => normalizeMessage(message))
        .filter((message): message is Message => !!message)
    : [];

  if (!id || !title || !updatedAt) {
    return null;
  }

  const normalizeRefreshRequest = (
    requestValue: unknown,
  ): SharedConversationRefreshRequest | undefined => {
    if (!requestValue || typeof requestValue !== 'object') {
      return undefined;
    }

    const requestRecord = requestValue as Record<string, unknown>;
    const shareUrl =
      typeof requestRecord.shareUrl === 'string' ? requestRecord.shareUrl.trim() : '';

    if (!shareUrl) {
      return undefined;
    }

    return {
      chatUrl:
        typeof requestRecord.chatUrl === 'string' && requestRecord.chatUrl.trim()
          ? requestRecord.chatUrl.trim()
          : undefined,
      conversationTitle:
        typeof requestRecord.conversationTitle === 'string' &&
        requestRecord.conversationTitle.trim()
          ? requestRecord.conversationTitle.trim()
          : undefined,
      mode:
        requestRecord.mode === 'chatgpt-share-flow' ||
        requestRecord.mode === 'direct-chat-page' ||
        requestRecord.mode === 'direct-share-page'
          ? requestRecord.mode
          : undefined,
      projectUrl:
        typeof requestRecord.projectUrl === 'string' &&
        requestRecord.projectUrl.trim()
          ? requestRecord.projectUrl.trim()
          : undefined,
      shareUrl,
    };
  };

  const normalizeImportWarning = (
    warningValue: unknown,
  ): SharedConversationImportWarning | undefined => {
    if (!warningValue || typeof warningValue !== 'object') {
      return undefined;
    }

    const warningRecord = warningValue as Record<string, unknown>;
    const code =
      (warningRecord.code === 'shared-deep-research-partial' ||
        warningRecord.code === 'chat-import-may-be-slow')
        ? warningRecord.code
        : null;
    const message =
      typeof warningRecord.message === 'string' && warningRecord.message.trim()
        ? warningRecord.message.trim()
        : '';

    if (!code || !message) {
      return undefined;
    }

    return {
      code,
      message,
    };
  };

  return {
    fetchedAt:
      typeof record.fetchedAt === 'string' && record.fetchedAt.trim()
        ? record.fetchedAt.trim()
        : undefined,
    id,
    importOrigin: record.importOrigin === 'chat-url' ? 'chat-url' : undefined,
    importWarning: normalizeImportWarning(record.importWarning),
    isSharedImport: record.isSharedImport === true,
    messages,
    projectSyncStatus:
      record.projectSyncStatus === 'viewer-created'
        ? 'viewer-created'
        : undefined,
    refreshRequest: normalizeRefreshRequest(record.refreshRequest),
    sourceUrl:
      typeof record.sourceUrl === 'string' && record.sourceUrl.trim()
        ? record.sourceUrl.trim()
        : undefined,
    summary,
    title,
    updatedAt,
  };
};

const buildFallbackWorkspaceNodeMeta = (
  orderIndex: number,
): WorkspaceNodeMeta => {
  const timestamp = new Date(Date.now() - orderIndex * 1000).toISOString();

  return {
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

const normalizeWorkspaceNodeMeta = (
  value: unknown,
  fallbackMeta: WorkspaceNodeMeta,
): WorkspaceNodeMeta => {
  if (!value || typeof value !== 'object') {
    return fallbackMeta;
  }

  const record = value as Record<string, unknown>;
  const createdAt =
    typeof record.createdAt === 'string' && record.createdAt.trim()
      ? record.createdAt.trim()
      : fallbackMeta.createdAt;
  const updatedAt =
    typeof record.updatedAt === 'string' && record.updatedAt.trim()
      ? record.updatedAt.trim()
      : createdAt;

  return {
    createdAt,
    updatedAt,
  };
};

const normalizeWorkspaceNode = (
  value: unknown,
  orderState: { index: number },
): WorkspaceNode | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const type = record.type;

  if (!id || (type !== 'conversation' && type !== 'folder')) {
    return null;
  }

  const fallbackMeta = buildFallbackWorkspaceNodeMeta(orderState.index);
  orderState.index += 1;
  const meta = normalizeWorkspaceNodeMeta(record.meta, fallbackMeta);

  if (type === 'conversation') {
    const conversationId =
      typeof record.conversationId === 'string' ? record.conversationId.trim() : '';

    if (!conversationId) {
      return null;
    }

    return {
      conversationId,
      id,
      meta,
      type,
    };
  }

  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const source = (() => {
    if (!record.source || typeof record.source !== 'object') {
      return undefined;
    }
    const sourceRecord = record.source as Record<string, unknown>;
    const projectUrl =
      typeof sourceRecord.projectUrl === 'string'
        ? sourceRecord.projectUrl.trim()
        : '';
    if (sourceRecord.kind !== 'project' || !projectUrl) {
      return undefined;
    }
    return {
      kind: 'project',
      projectUrl,
    } satisfies WorkspaceFolderSource;
  })();
  const sortMode =
    record.sortMode === 'asc' || record.sortMode === 'desc' || record.sortMode === 'none'
      ? (record.sortMode as WorkspaceFolderSortMode)
      : undefined;
  const children = Array.isArray(record.children)
    ? record.children
        .map((childNode) => normalizeWorkspaceNode(childNode, orderState))
        .filter((childNode): childNode is WorkspaceNode => !!childNode)
    : [];

  if (!name) {
    return null;
  }

  return {
    children,
    id,
    meta,
    name,
    source,
    sortMode,
    type,
  };
};

const normalizeExpandedFolderState = (
  value: unknown,
): Record<string, boolean> => {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return Object.entries(value as Record<string, unknown>).reduce<
    Record<string, boolean>
  >((state, [folderId, isExpanded]) => {
    if (typeof folderId === 'string' && typeof isExpanded === 'boolean') {
      state[folderId] = isExpanded;
    }

    return state;
  }, {});
};

export const buildWorkspaceSnapshot = (
  state: WorkspacePersistenceState,
  savedAt = new Date().toISOString(),
): WorkspaceSnapshot => ({
  activeConversationId: state.activeConversationId,
  conversations: state.conversations,
  expandedFolderState: state.expandedFolderState,
  savedAt,
  schemaVersion: WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
  workspaceTree: state.workspaceTree,
});

export const workspaceStateFromSnapshot = (
  snapshot: WorkspaceSnapshot,
): WorkspacePersistenceState => ({
  activeConversationId: snapshot.activeConversationId,
  conversations: snapshot.conversations,
  expandedFolderState: snapshot.expandedFolderState,
  workspaceTree: snapshot.workspaceTree,
});

export const normalizeWorkspaceSnapshot = (
  value: unknown,
): WorkspaceSnapshot | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const schemaVersion = record.schemaVersion;

  if (schemaVersion !== WORKSPACE_SNAPSHOT_SCHEMA_VERSION) {
    return null;
  }

  const conversations = Array.isArray(record.conversations)
    ? record.conversations
        .map((conversation) => normalizeConversation(conversation))
        .filter((conversation): conversation is Conversation => !!conversation)
    : [];
  const workspaceNodeOrderState = { index: 0 };
  const workspaceTree = Array.isArray(record.workspaceTree)
    ? record.workspaceTree
        .map((node) => normalizeWorkspaceNode(node, workspaceNodeOrderState))
        .filter((node): node is WorkspaceNode => !!node)
    : [];
  const expandedFolderState = normalizeExpandedFolderState(
    record.expandedFolderState,
  );
  const requestedActiveConversationId =
    typeof record.activeConversationId === 'string'
      ? record.activeConversationId
      : '';
  const hasRequestedConversation = conversations.some(
    (conversation) => conversation.id === requestedActiveConversationId,
  );

  return {
    activeConversationId: hasRequestedConversation
      ? requestedActiveConversationId
      : conversations[0]?.id || '',
    conversations,
    expandedFolderState,
    savedAt:
      typeof record.savedAt === 'string' && record.savedAt.trim()
        ? record.savedAt.trim()
        : new Date().toISOString(),
    schemaVersion: WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
    workspaceTree,
  };
};
