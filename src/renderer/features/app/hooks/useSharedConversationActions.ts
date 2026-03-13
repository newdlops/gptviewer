import { useEffect, useState, type Dispatch, type FormEvent, type MutableRefObject, type SetStateAction } from 'react';
import { decodeSharedConversationRefreshError } from '../../../../shared/refresh/sharedConversationRefreshErrorCodec';
import { normalizeImportedConversation } from '../../conversations/lib/normalizers';
import {
  canDropNodeInFolder,
  findConversationNodeId,
  findFolderById,
  insertConversationIntoFolder,
  moveNodeInTree,
  WORKSPACE_ROOT_VALUE,
} from '../../conversations/lib/workspaceTree';
import type { Conversation, SourceDrawerState, WorkspaceNode } from '../../../types/chat';
import {
  isRefreshableSharedConversation,
  parseFolderSelectValue,
  type SharedConversationRefreshConfigState,
} from '../lib/appTypes';
import {
  buildConversationFromImport,
  buildRefreshRequest,
  normalizeChatUrl,
  isChatUrlImportedConversation,
} from '../lib/sharedConversationUtils';
import {
  loadSharedConversationImportPreferences,
  saveSharedConversationImportPreferences,
  type SharedConversationImportStrategyPreference,
} from '../lib/sharedConversationImportPreferences';

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
  const [sharedImportPreferredStrategy, setSharedImportPreferredStrategy] =
    useState<SharedConversationImportStrategyPreference>(() =>
      loadSharedConversationImportPreferences().preferredStrategy,
    );
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isImportingSharedConversation, setIsImportingSharedConversation] = useState(false);
  const [importError, setImportError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [refreshingConversationId, setRefreshingConversationId] = useState<string | null>(null);
  const [sendMessageStatus, setSendMessageStatus] = useState<'idle' | 'sending' | 'receiving'>('idle');
  const [refreshConfigState, setRefreshConfigState] =
    useState<SharedConversationRefreshConfigState | null>(null);

  const formatRefreshErrorMessage = (error: unknown) => {
    if (!(error instanceof Error)) {
      return '대화를 새로고침하지 못했습니다.';
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
        return `${decodedError.message} 실패가 반복되면 공유 대화 URL 직접 새로고침으로 바꿔 보세요.`;
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
    if (!isImportModalOpen || importFolderId) {
      return;
    }

    setImportFolderId(WORKSPACE_ROOT_VALUE);
  }, [importFolderId, isImportModalOpen]);

  useEffect(() => {
    saveSharedConversationImportPreferences({
      preferredStrategy: sharedImportPreferredStrategy,
    });
  }, [sharedImportPreferredStrategy]);

  useEffect(() => {
    const hasShareUrl = shareUrl.trim().length > 0;
    const hasChatUrl = importChatUrl.trim().length > 0;

    if (hasChatUrl && !hasShareUrl && sharedImportPreferredStrategy === 'share-url-first') {
      setSharedImportPreferredStrategy('chat-url-first');
      return;
    }

    if (hasShareUrl && !hasChatUrl && sharedImportPreferredStrategy === 'chat-url-first') {
      setSharedImportPreferredStrategy('share-url-first');
    }
  }, [importChatUrl, shareUrl, sharedImportPreferredStrategy]);

  useEffect(() => {
    setRefreshError('');
    // Clear loading states when switching conversations to prevent UI lock
    setRefreshingConversationId(null);
    setSendMessageStatus('idle');
  }, [activeConversation?.id]);

  const handleImportSharedConversation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedUrl = shareUrl.trim();
    const normalizedChatUrl = normalizeChatUrl(importChatUrl) ?? importChatUrl.trim();
    const targetFolderId = parseFolderSelectValue(importFolderId);
    if (isImportingSharedConversation) return;
    if (sharedImportPreferredStrategy === 'chat-url-first' && !normalizedChatUrl) {
      return setImportError('원본 ChatGPT 대화 URL을 입력해 주세요.');
    }
    if (sharedImportPreferredStrategy === 'share-url-first' && !normalizedUrl) {
      return setImportError('공유 대화 URL을 입력해 주세요.');
    }
    if (!importFolderId) return setImportError('대화를 넣을 폴더를 선택해 주세요.');
    if (targetFolderId && !findFolderById(workspaceTree, targetFolderId)) {
      return setImportError('선택한 폴더를 찾을 수 없습니다.');
    }

    setImportError('');
    setIsImportingSharedConversation(true);
    try {
      const cachedConversation = conversations.find((conversation) => {
        if (!conversation.isSharedImport) {
          return false;
        }

        if (normalizedUrl && conversation.sourceUrl === normalizedUrl) {
          return true;
        }

        if (normalizedChatUrl && conversation.refreshRequest?.chatUrl === normalizedChatUrl) {
          return true;
        }

        return normalizedChatUrl !== '' && conversation.sourceUrl === normalizedChatUrl;
      });

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
          if (!existingNodeId) {
            return insertConversationIntoFolder(
              currentTree,
              targetFolderId,
              cachedConversation.id,
            );
          }
          if (!canDropNodeInFolder(currentTree, existingNodeId, targetFolderId)) {
            return currentTree;
          }
          return moveNodeInTree(currentTree, existingNodeId, targetFolderId);
        });
        if (targetFolderId) {
          setExpandedFolderState((current) => ({ ...current, [targetFolderId]: true }));
        }
        setActiveConversationId(cachedConversation.id);
        setIsImportModalOpen(false);
        return;
      }

      const importDirectChatConversation = async () =>
        normalizeImportedConversation(
          await window.electronAPI?.importChatGptConversation({
            chatUrl: normalizedChatUrl,
            conversationTitle: '',
            helperWindowMode: 'background',
            mode: 'direct-chat-page',
            projectUrl: importProjectUrl.trim() || undefined,
            shareUrl: normalizedChatUrl,
          }),
        );

      const importSharedConversation = async () =>
        normalizeImportedConversation(
          await window.electronAPI?.fetchSharedConversation(normalizedUrl),
        );

      const attempts =
        sharedImportPreferredStrategy === 'chat-url-first'
          ? [
              async () => {
                if (!normalizedChatUrl) {
                  throw new Error('원본 ChatGPT 대화 URL을 입력해 주세요.');
                }
                return importDirectChatConversation();
              },
              async () => {
                if (!normalizedUrl) {
                  throw new Error('공유 대화 URL을 입력해 주세요.');
                }
                return importSharedConversation();
              },
            ]
          : [
              async () => {
                if (!normalizedUrl) {
                  throw new Error('공유 대화 URL을 입력해 주세요.');
                }
                return importSharedConversation();
              },
              async () => {
                if (!normalizedChatUrl) {
                  throw new Error('원본 ChatGPT 대화 URL을 입력해 주세요.');
                }
                return importDirectChatConversation();
              },
            ];

      let importedConversation: ReturnType<typeof normalizeImportedConversation> | null = null;
      let lastImportError: unknown = null;

      for (const attempt of attempts) {
        try {
          importedConversation = await attempt();
          if (importedConversation) {
            break;
          }
        } catch (error) {
          lastImportError = error;
        }
      }

      if (!importedConversation && lastImportError) {
        throw lastImportError;
      }

      if (!importedConversation) throw new Error('대화를 불러오는 기능을 사용할 수 없습니다.');
      if (importedConversation.messages.length === 0) throw new Error('공유 페이지에서 대화 내용을 찾지 못했습니다.');

      const conversationId = `shared-${Date.now()}`;
      const nextRefreshRequest = buildRefreshRequest(
        importedConversation.sourceUrl || normalizedUrl || normalizedChatUrl,
        importedConversation.title,
        importChatUrl,
        importProjectUrl,
        sharedImportPreferredStrategy === 'chat-url-first'
          ? 'direct-chat-page'
          : importChatUrl.trim()
            ? 'chatgpt-share-flow'
            : 'direct-share-page',
      );
      setConversations((current) => [
        buildConversationFromImport(conversationId, {
          ...importedConversation,
          refreshRequest: nextRefreshRequest,
        }),
        ...current,
      ]);
      setWorkspaceTree((currentTree) =>
        insertConversationIntoFolder(currentTree, targetFolderId, conversationId),
      );
      if (targetFolderId) {
        setExpandedFolderState((current) => ({ ...current, [targetFolderId]: true }));
      }
      setActiveConversationId(conversationId);
      setIsImportModalOpen(false);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '대화를 불러오지 못했습니다.');
    } finally {
      setIsImportingSharedConversation(false);
    }
  };

  const handleRefreshActiveConversation = async () => {
    const targetConversationId = activeConversation?.id;
    if (!isRefreshableSharedConversation(activeConversation) || !targetConversationId || refreshingConversationId === targetConversationId) return;

    setRefreshError('');
    setRefreshingConversationId(targetConversationId);
    try {
      const refreshRequest = activeConversation.refreshRequest ?? {
        conversationTitle: activeConversation.title,
        helperWindowMode: 'background',
        mode: isChatUrlImportedConversation(activeConversation)
          ? 'direct-chat-page'
          : 'direct-share-page',
        shareUrl: activeConversation.sourceUrl,
      };
      const nextRefreshRequest = {
        ...refreshRequest,
        helperWindowMode: refreshRequest.helperWindowMode ?? 'background',
      };
      if (
        (nextRefreshRequest.mode === 'chatgpt-share-flow' ||
          nextRefreshRequest.mode === 'direct-chat-page') &&
        !nextRefreshRequest.chatUrl
      ) {
        throw new Error('원본 ChatGPT 대화 URL을 먼저 연결해 주세요.');
      }
      const importedConversation = normalizeImportedConversation(
        await window.electronAPI?.refreshSharedConversation(
          nextRefreshRequest,
        ),
      );
      if (!importedConversation) throw new Error('대화를 새로고침할 수 없습니다.');
      if (importedConversation.messages.length === 0) throw new Error('공유 페이지에서 최신 대화 내용을 찾지 못했습니다.');

      messageHeightCacheRef.current[targetConversationId] = {};
      setConversations((currentConversations) =>
        currentConversations.map((conversation) =>
          conversation.id === targetConversationId
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

  const handleSendMessageToActiveConversation = async (message: string) => {
    if (!activeConversation || sendMessageStatus !== 'idle') return;

    const chatUrl = activeConversation.refreshRequest?.chatUrl ||
                   (isChatUrlImportedConversation(activeConversation) ? activeConversation.sourceUrl : null);

    if (!chatUrl) {
      setRefreshError('메시지를 보낼 원본 ChatGPT 링크가 없습니다. 새로고침 설정에서 원본 링크를 연결해 주세요.');
      return;
    }

    setSendMessageStatus('sending');
    setRefreshError('');

    try {
      const refreshRequest = activeConversation.refreshRequest ?? {
        chatUrl,
        conversationTitle: activeConversation.title,
        helperWindowMode: 'background',
        mode: 'direct-chat-page',
        shareUrl: activeConversation.sourceUrl,
      };

      // API call initiates
      const result = await window.electronAPI?.sendMessageToSharedConversation(
        refreshRequest,
        message
      );

      const importedConversation = normalizeImportedConversation(result);

      if (!importedConversation) throw new Error('메시지 전송 후 대화를 갱신하지 못했습니다.');

      messageHeightCacheRef.current[activeConversation.id] = {};
      setConversations((currentConversations) =>
        currentConversations.map((conversation) =>
          conversation.id === activeConversation.id
            ? buildConversationFromImport(conversation.id, importedConversation)
            : conversation
        )
      );
      setSourceDrawer(null);
    } catch (error) {
      setRefreshError(formatRefreshErrorMessage(error));
    } finally {
      setSendMessageStatus('idle');
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
      mode:
        conversation.refreshRequest?.mode ??
        (isChatUrlImportedConversation(conversation)
          ? 'direct-chat-page'
          : 'direct-share-page'),
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

    if (
      (refreshConfigState.mode === 'chatgpt-share-flow' ||
        refreshConfigState.mode === 'direct-chat-page') &&
      !nextRefreshRequest.chatUrl
    ) {
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
    handleSendMessageToActiveConversation,
    importChatUrl,
    importError,
    importFolderId,
    importProjectUrl,
    isImportModalOpen,
    isImportingSharedConversation,
    sendMessageStatus,
    openRefreshConfigModal,
    refreshError,
    refreshConfigState,
    refreshingConversationId,
    setSharedImportPreferredStrategy,
    setImportChatUrl,
    setImportFolderId,
    setIsImportModalOpen,
    setImportProjectUrl,
    setRefreshConfigState,
    setShareUrl,
    shareUrl,
    sharedImportPreferredStrategy,
  };
}
