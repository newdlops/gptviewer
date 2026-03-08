import { useState, type Dispatch, type SetStateAction } from 'react';
import type { Conversation, SourceDrawerState } from '../../../types/chat';
import type { ClearConversationState } from '../lib/appTypes';

type UseConversationContentActionsArgs = {
  conversations: Conversation[];
  removeConversationScrollState: (conversationIds: string[]) => void;
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
  setSourceDrawer: Dispatch<SetStateAction<SourceDrawerState | null>>;
};

export function useConversationContentActions({
  conversations,
  removeConversationScrollState,
  setConversations,
  setSourceDrawer,
}: UseConversationContentActionsArgs) {
  const [clearConversationState, setClearConversationState] =
    useState<ClearConversationState | null>(null);

  const openClearConversationModal = (conversationId: string) => {
    const conversation = conversations.find((item) => item.id === conversationId);
    if (!conversation) {
      return;
    }

    setClearConversationState({
      conversationId,
      conversationTitle: conversation.title,
    });
  };

  const clearConversationContent = (conversationId: string) => {
    const conversation = conversations.find((item) => item.id === conversationId);
    if (!conversation) {
      return;
    }

    removeConversationScrollState([conversationId]);
    setSourceDrawer(null);
    setConversations((currentConversations) =>
      currentConversations.map((currentConversation) =>
        currentConversation.id === conversationId
          ? {
              ...currentConversation,
              messages: [],
              summary: '',
              updatedAt: '방금 전',
            }
          : currentConversation,
      ),
    );
  };

  return {
    clearConversationContent,
    clearConversationState,
    openClearConversationModal,
    setClearConversationState,
  };
}
