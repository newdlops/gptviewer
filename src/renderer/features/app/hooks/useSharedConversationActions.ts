import { useEffect, useState, type Dispatch, type FormEvent, type MutableRefObject, type SetStateAction } from 'react';
import { decodeSharedConversationRefreshError } from '../../../../shared/refresh/sharedConversationRefreshErrorCodec';
import { normalizeImportedConversation } from '../../conversations/lib/normalizers';
import {
  canDropNodeInFolder,
  findConversationNodeId,
  findFolderById,
  insertConversationIntoFolder,
  moveNodeInTree,
} from '../../conversations/lib/workspaceTree';
import type { Conversation, SourceDrawerState, WorkspaceNode } from '../../../types/chat';
import {
  isRefreshableSharedConversation,
  type SharedConversationRefreshConfigState,
} from '../lib/appTypes';
import {
  buildConversationFromImport,
  buildRefreshRequest,
} from '../lib/sharedConversationUtils';

type UseSharedConversationActionsArgs = {
  activeConversation: Conversation | null;
  conversations: Conversation[];
  messageHeightCacheRef: MutableRefObject<Record<string, Record<string, number>>>;
  setActiveConversationId: (value: string) => void;
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
  setExpandedFolderState: Dispatch<SetStateAction<Record<string, boolean>>>;
  setSourceDrawer: Dispatch<SetStateAction<SourceDrawerState | null>>;
  setWorkspaceTree: Dispatch<SetStateAction<WorkspaceNode[]>>;
  workspaceTree: WorkspaceNode[];
};

export function useSharedConversationActions({
  activeConversation,
  conversations,
  messageHeightCacheRef,
  setActiveConversationId,
  setConversations,
  setExpandedFolderState,
  setSourceDrawer,
  setWorkspaceTree,
  workspaceTree,
}: UseSharedConversationActionsArgs) {
  const [shareUrl, setShareUrl] = useState('');
  const [importFolderId, setImportFolderId] = useState('');
  const [importChatUrl, setImportChatUrl] = useState('');
  const [importProjectUrl, setImportProjectUrl] = useState('');
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isImportingSharedConversation, setIsImportingSharedConversation] = useState(false);
  const [importError, setImportError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [refreshingConversationId, setRefreshingConversationId] = useState<string | null>(null);
  const [refreshConfigState, setRefreshConfigState] =
    useState<SharedConversationRefreshConfigState | null>(null);

  const formatRefreshErrorMessage = (error: unknown) => {
    if (!(error instanceof Error)) {
      return '공유 대화를 새로고침하지 못했습니다.';
    }

    const decodedError = decodeSharedConversationRefreshError(error.message);
    if (!decodedError) {
      return error.message;
    }

    switch (decodedError.code) {
      case 'login_required':
        return `${decodedError.message} 보조 ChatGPT 창에서 로그인 또는 인증을 마친 뒤 다시 시도해 주세요.`;
      case 'share_button_not_found':
      case 'share_update_button_not_found':
        return `${decodedError.message} 새로고침 설정에서 원본 ChatGPT 대화 URL이 맞는지도 확인해 주세요.${decodedError.detail ? `\n\n상세: ${decodedError.detail}` : ''}`;
      case 'clipboard_read_failed':
        return `${decodedError.message} 실패가 반복되면 공유 링크 직접 새로고침으로 바꿔 보세요.`;
      case 'chat_url_missing':
        return decodedError.message;
      case 'window_closed':
        return decodedError.message;
      default:
        return decodedError.message;
    }
  };

  useEffect(() => {
    if (isImportModalOpen) return;
    setImportError('');
    setIsImportingSharedConversation(false);
    setShareUrl('');
    setImportFolderId('');
    setImportChatUrl('');
    setImportProjectUrl('');
  }, [isImportModalOpen]);

  useEffect(() => {
    setRefreshError('');
  }, [activeConversation?.id]);

  const handleImportSharedConversation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedUrl = shareUrl.trim();
    if (isImportingSharedConversation) return;
    if (!normalizedUrl) return setImportError('공유 URL을 입력해 주세요.');
    if (!importFolderId) return setImportError('대화를 넣을 폴더를 선택해 주세요.');
    if (!findFolderById(workspaceTree, importFolderId)) return setImportError('선택한 폴더를 찾을 수 없습니다.');

    setImportError('');
    setIsImportingSharedConversation(true);
    try {
      const cachedConversation = conversations.find(
        (conversation) => conversation.isSharedImport && conversation.sourceUrl === normalizedUrl,
      );

      if (cachedConversation) {
        if (importChatUrl.trim() || importProjectUrl.trim()) {
          const nextChatUrl =
            importChatUrl.trim() || cachedConversation.refreshRequest?.chatUrl || '';
          const nextProjectUrl =
            importProjectUrl.trim() || cachedConversation.refreshRequest?.projectUrl || '';
          setConversations((currentConversations) =>
            currentConversations.map((conversation) =>
              conversation.id === cachedConversation.id
                ? {
                    ...conversation,
                    refreshRequest: buildRefreshRequest(
                      conversation.sourceUrl ?? normalizedUrl,
                      conversation.title,
                      nextChatUrl,
                      nextProjectUrl,
                      nextChatUrl ? 'chatgpt-share-flow' : conversation.refreshRequest?.mode,
                    ),
                  }
                : conversation,
            ),
          );
        }
        setWorkspaceTree((currentTree) => {
          const existingNodeId = findConversationNodeId(currentTree, cachedConversation.id);
          if (!existingNodeId) return insertConversationIntoFolder(currentTree, importFolderId, cachedConversation.id);
          if (!canDropNodeInFolder(currentTree, existingNodeId, importFolderId)) return currentTree;
          return moveNodeInTree(currentTree, existingNodeId, importFolderId);
        });
        setExpandedFolderState((current) => ({ ...current, [importFolderId]: true }));
        setActiveConversationId(cachedConversation.id);
        setIsImportModalOpen(false);
        return;
      }

      const importedConversation = normalizeImportedConversation(
        await window.electronAPI?.fetchSharedConversation(normalizedUrl),
      );
      if (!importedConversation) throw new Error('공유 대화를 불러오는 기능을 사용할 수 없습니다.');
      if (importedConversation.messages.length === 0) throw new Error('공유 페이지에서 대화 내용을 찾지 못했습니다.');

      const conversationId = `shared-${Date.now()}`;
      const nextRefreshRequest = buildRefreshRequest(
        importedConversation.sourceUrl || normalizedUrl,
        importedConversation.title,
        importChatUrl,
        importProjectUrl,
        importChatUrl.trim() ? 'chatgpt-share-flow' : 'direct-share-page',
      );
      setConversations((current) => [
        buildConversationFromImport(conversationId, {
          ...importedConversation,
          refreshRequest: nextRefreshRequest,
        }),
        ...current,
      ]);
      setWorkspaceTree((currentTree) => insertConversationIntoFolder(currentTree, importFolderId, conversationId));
      setExpandedFolderState((current) => ({ ...current, [importFolderId]: true }));
      setActiveConversationId(conversationId);
      setIsImportModalOpen(false);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '공유 대화를 불러오지 못했습니다.');
    } finally {
      setIsImportingSharedConversation(false);
    }
  };

  const handleRefreshActiveConversation = async () => {
    if (!isRefreshableSharedConversation(activeConversation) || refreshingConversationId === activeConversation.id) return;
    setRefreshError('');
    setRefreshingConversationId(activeConversation.id);
    try {
      const refreshRequest = activeConversation.refreshRequest ?? {
        conversationTitle: activeConversation.title,
        mode: 'direct-share-page',
        shareUrl: activeConversation.sourceUrl,
      };
      if (refreshRequest.mode === 'chatgpt-share-flow' && !refreshRequest.chatUrl) {
        throw new Error('원본 ChatGPT 대화 URL을 먼저 연결해 주세요.');
      }
      const importedConversation = normalizeImportedConversation(
        await window.electronAPI?.refreshSharedConversation(
          refreshRequest,
        ),
      );
      if (!importedConversation) throw new Error('공유 대화를 새로고침할 수 없습니다.');
      if (importedConversation.messages.length === 0) throw new Error('공유 페이지에서 최신 대화 내용을 찾지 못했습니다.');

      messageHeightCacheRef.current[activeConversation.id] = {};
      setConversations((currentConversations) =>
        currentConversations.map((conversation) =>
          conversation.id === activeConversation.id
            ? buildConversationFromImport(conversation.id, importedConversation)
            : conversation,
        ),
      );
      setSourceDrawer(null);
    } catch (error) {
      setRefreshError(formatRefreshErrorMessage(error));
    } finally {
      setRefreshingConversationId(null);
    }
  };

  const openRefreshConfigModal = (conversationId: string) => {
    const conversation = conversations.find((item) => item.id === conversationId);
    if (!conversation?.sourceUrl) {
      return;
    }

    setRefreshConfigState({
      chatUrl: conversation.refreshRequest?.chatUrl ?? '',
      conversationId,
      conversationTitle: conversation.title,
      mode: conversation.refreshRequest?.mode ?? 'direct-share-page',
      projectUrl: conversation.refreshRequest?.projectUrl ?? '',
      shareUrl: conversation.refreshRequest?.shareUrl ?? conversation.sourceUrl,
    });
  };

  const handleRefreshConfigSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!refreshConfigState) {
      return;
    }

    const nextRefreshRequest = buildRefreshRequest(
      refreshConfigState.shareUrl,
      refreshConfigState.conversationTitle,
      refreshConfigState.chatUrl,
      refreshConfigState.projectUrl,
      refreshConfigState.mode,
    );

    if (refreshConfigState.mode === 'chatgpt-share-flow' && !nextRefreshRequest.chatUrl) {
      setRefreshError('자동 새로고침에는 원본 ChatGPT 대화 URL이 필요합니다.');
      return;
    }

    setConversations((currentConversations) =>
      currentConversations.map((conversation) =>
        conversation.id === refreshConfigState.conversationId
          ? {
              ...conversation,
              refreshRequest: nextRefreshRequest,
            }
          : conversation,
      ),
    );
    setRefreshConfigState(null);
  };

  return {
    handleImportSharedConversation,
    handleRefreshConfigSubmit,
    handleRefreshActiveConversation,
    importChatUrl,
    importError,
    importFolderId,
    importProjectUrl,
    isImportModalOpen,
    isImportingSharedConversation,
    openRefreshConfigModal,
    refreshError,
    refreshConfigState,
    refreshingConversationId,
    setImportChatUrl,
    setImportFolderId,
    setIsImportModalOpen,
    setImportProjectUrl,
    setRefreshConfigState,
    setShareUrl,
    shareUrl,
  };
}
