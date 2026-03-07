import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Conversation, SourceDrawerState, WorkspaceNode } from '../../../types/chat';
import { useProjectConversationImportActions } from './useProjectConversationImportActions';
import { useSharedConversationActions } from './useSharedConversationActions';
import { useWorkspaceTreeActions } from './useWorkspaceTreeActions';

type UseWorkspaceActionsArgs = {
  activeConversation: Conversation | null;
  activeConversationId: string;
  conversations: Conversation[];
  messageHeightCacheRef: MutableRefObject<Record<string, Record<string, number>>>;
  removeConversationScrollState: (conversationIds: string[]) => void;
  setActiveConversationId: (value: string) => void;
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
  setExpandedFolderState: Dispatch<SetStateAction<Record<string, boolean>>>;
  setSourceDrawer: Dispatch<SetStateAction<SourceDrawerState | null>>;
  setWorkspaceTree: Dispatch<SetStateAction<WorkspaceNode[]>>;
  workspaceTree: WorkspaceNode[];
};

export function useWorkspaceActions(args: UseWorkspaceActionsArgs) {
  const treeActions = useWorkspaceTreeActions({
    activeConversationId: args.activeConversationId,
    conversations: args.conversations,
    removeConversationScrollState: args.removeConversationScrollState,
    setActiveConversationId: args.setActiveConversationId,
    setConversations: args.setConversations,
    setExpandedFolderState: args.setExpandedFolderState,
    setSourceDrawer: args.setSourceDrawer,
    setWorkspaceTree: args.setWorkspaceTree,
    workspaceTree: args.workspaceTree,
  });

  const sharedConversationActions = useSharedConversationActions({
    activeConversation: args.activeConversation,
    conversations: args.conversations,
    messageHeightCacheRef: args.messageHeightCacheRef,
    setActiveConversationId: args.setActiveConversationId,
    setConversations: args.setConversations,
    setExpandedFolderState: args.setExpandedFolderState,
    setSourceDrawer: args.setSourceDrawer,
    setWorkspaceTree: args.setWorkspaceTree,
    workspaceTree: args.workspaceTree,
  });
  const projectConversationImportActions = useProjectConversationImportActions({
    conversations: args.conversations,
    messageHeightCacheRef: args.messageHeightCacheRef,
    setActiveConversationId: args.setActiveConversationId,
    setConversations: args.setConversations,
    setExpandedFolderState: args.setExpandedFolderState,
    setSourceDrawer: args.setSourceDrawer,
    setWorkspaceTree: args.setWorkspaceTree,
    workspaceTree: args.workspaceTree,
  });

  return {
    ...projectConversationImportActions,
    ...treeActions,
    ...sharedConversationActions,
  };
}
