import type {
  ProjectConversationLink,
  ProjectConversationSyncSummary,
} from '../../../../shared/import/projectConversationImport';
import type { Conversation, WorkspaceNode } from '../../../types/chat';
import { findFolderById } from '../../conversations/lib/workspaceTree';

type ProjectFolderConversationState = {
  conversationId: string;
  chatUrl?: string;
};

export type ProjectFolderSyncPlan = {
  existingMatchedChatUrls: Set<string>;
  folderConversationIds: Set<string>;
  summary: ProjectConversationSyncSummary;
  viewerCreatedConversationIds: Set<string>;
  missingConversations: ProjectConversationLink[];
};

const collectFolderConversationStates = (
  nodes: WorkspaceNode[],
  conversationsById: Map<string, Conversation>,
): ProjectFolderConversationState[] =>
  nodes.flatMap((node) => {
    if (node.type === 'conversation') {
      const conversation = conversationsById.get(node.conversationId);

      if (!conversation) {
        return [];
      }

      return [
        {
          chatUrl: conversation.refreshRequest?.chatUrl,
          conversationId: conversation.id,
        },
      ];
    }

    return collectFolderConversationStates(node.children, conversationsById);
  });

export const createProjectFolderSyncPlan = ({
  collectedConversations,
  conversations,
  folderId,
  workspaceTree,
  isForceSync = false,
}: {
  collectedConversations: ProjectConversationLink[];
  conversations: Conversation[];
  folderId: string;
  workspaceTree: WorkspaceNode[];
  isForceSync?: boolean;
}): ProjectFolderSyncPlan => {
  const folder = findFolderById(workspaceTree, folderId);
  const conversationsById = new Map(
    conversations.map((conversation) => [conversation.id, conversation] as const),
  );
  const folderConversationStates = folder
    ? collectFolderConversationStates(folder.children, conversationsById)
    : [];
  const collectedByChatUrl = new Map(
    collectedConversations.map((conversation) => [conversation.chatUrl, conversation] as const),
  );
  const existingMatchedChatUrls = new Set<string>();
  const folderConversationIds = new Set(
    folderConversationStates.map((conversation) => conversation.conversationId),
  );
  const viewerCreatedConversationIds = new Set<string>();

  folderConversationStates.forEach((conversationState) => {
    // If not force sync, check if conversation already exists in folder
    if (
      !isForceSync &&
      conversationState.chatUrl &&
      collectedByChatUrl.has(conversationState.chatUrl)
    ) {
      existingMatchedChatUrls.add(conversationState.chatUrl);
      return;
    }

    viewerCreatedConversationIds.add(conversationState.conversationId);
  });

  return {
    existingMatchedChatUrls,
    folderConversationIds,
    missingConversations: collectedConversations.filter(
      (conversation) => !existingMatchedChatUrls.has(conversation.chatUrl),
    ),
    summary: {
      collectedCount: collectedConversations.length,
      matchedCount: existingMatchedChatUrls.size,
      missingCount: collectedConversations.length - existingMatchedChatUrls.size,
      viewerCreatedCount: viewerCreatedConversationIds.size,
    },
    viewerCreatedConversationIds,
  };
};

export const applyProjectFolderSyncStatuses = (
  conversations: Conversation[],
  folderConversationIds: Set<string>,
  viewerCreatedConversationIds: Set<string>,
): Conversation[] =>
  conversations.map((conversation) => {
    if (!folderConversationIds.has(conversation.id)) {
      return conversation;
    }

    const nextStatus = viewerCreatedConversationIds.has(conversation.id)
      ? 'viewer-created'
      : undefined;

    if (conversation.projectSyncStatus === nextStatus) {
      return conversation;
    }

    return {
      ...conversation,
      projectSyncStatus: nextStatus,
    };
  });
