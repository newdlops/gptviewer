import { useEffect, useRef, useState, type Dispatch, type FormEvent, type MutableRefObject, type SetStateAction } from 'react';
import { decodeSharedConversationRefreshError } from '../../../../shared/refresh/sharedConversationRefreshErrorCodec';
import { normalizeImportedConversation } from '../../conversations/lib/normalizers';
import type { Message } from '../../../types/chat';
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
  const [streamingStatuses, setStreamingStatuses] = useState<Record<string, 'idle' | 'sending' | 'receiving'>>({});
  const lastChunkReceivedAtRef = useRef<Record<string, number>>({});

  // Use localStorage to provide an instant cached model list while the background fetch happens

  const [modelConfig, setModelConfig] = useState<any>(() => {
    try {
      const cached = localStorage.getItem('gptviewer-cached-model-config');
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  
  const [selectedModel, setSelectedModel] = useState<string>(() => localStorage.getItem('gptviewer-selected-model') || 'auto');
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
  }, [activeConversation?.id]);

  useEffect(() => {
    const removeStatusListener = window.electronAPI?.onSharedConversationStatusUpdate((status: 'sending' | 'receiving' | 'idle', conversationId?: string) => {
      if (conversationId) {
        setStreamingStatuses((prev) => ({ ...prev, [conversationId]: status }));
        if (status === 'receiving') {
          lastChunkReceivedAtRef.current[conversationId] = Date.now();
        }
      }
    });

    const removeStreamListener = window.electronAPI?.onChatGptStreamChunk((chunk: string, conversationId: string) => {
      if (!conversationId) return;

      if (chunk === '__GPT_STREAM_DONE__') {
        setStreamingStatuses((prev) => ({ ...prev, [conversationId]: 'idle' }));
        delete lastChunkReceivedAtRef.current[conversationId];
        
        // 메시지 상태도 최종적으로 '완료' 상태로 정리 (커서 제거를 위해 placeholder ID 변경)
        setConversations((currentConversations) =>
          currentConversations.map((convo) => {
            if (convo.id !== conversationId) return convo;
            const updatedMessages = [...convo.messages];
            if (updatedMessages.length === 0) return convo;
            
            const lastMessage = updatedMessages[updatedMessages.length - 1];
            if (lastMessage.id === 'streaming-placeholder') {
              // ID를 변경하여 CSS의 [data-streaming="true"] 선택자가 더 이상 매칭되지 않게 함
              lastMessage.id = `finished-${Date.now()}`;
            }
            return { ...convo, messages: updatedMessages };
          }),
        );
        return;
      }

      lastChunkReceivedAtRef.current[conversationId] = Date.now();
      setStreamingStatuses((prev) => ({ ...prev, [conversationId]: 'receiving' }));

      setConversations((currentConversations) =>
        currentConversations.map((convo) => {
          if (convo.id !== conversationId) return convo;

          const updatedMessages = [...convo.messages];
          if (updatedMessages.length === 0) return convo;
          
          const lastMessage = { ...updatedMessages[updatedMessages.length - 1] };
          updatedMessages[updatedMessages.length - 1] = lastMessage;

          if (chunk.startsWith('__GPT_RAW_PATCH__:')) {
            const jsonPart = chunk.substring('__GPT_RAW_PATCH__:'.length);
            try {
              const data = JSON.parse(jsonPart);
              const patches = Array.isArray(data.v) ? data.v : [data];
              
              for (const patch of patches) {
                // 1. Text Append 처리
                if (patch.p === '/message/content/parts/0' || patch.p === '/message/content/parts/0/v') {
                  if (patch.o === 'append' && typeof patch.v === 'string') {
                    lastMessage.text += patch.v;
                  } else if (patch.o === 'replace' && typeof patch.v === 'string') {
                    lastMessage.text = patch.v;
                  }
                }
                
                // 2. Metadata (Citations/Sources) 처리
                if (patch.p?.includes('metadata/content_references') || patch.p?.includes('metadata/safe_urls')) {
                  const items = patch.v?.items || patch.v;
                  if (Array.isArray(items)) {
                    for (const item of items) {
                      if (item.url && !lastMessage.sources.some((s: any) => s.url === item.url)) {
                        lastMessage.sources.push({
                          url: item.url,
                          title: item.title || item.attribution || '출처',
                          attribution: item.attribution,
                          description: item.snippet
                        });
                      }
                    }
                  }
                }
              }
            } catch (e) {
              console.warn('[gptviewer] Error parsing stream patch:', e);
            }
          } else {
            // 일반 텍스트 델타 처리
            lastMessage.text += chunk;
          }

          return { ...convo, messages: updatedMessages };
        }),
      );
    });

    // Fallback timer: check every 2 seconds for conversations that stopped streaming without DONE signal
    const intervalId = setInterval(() => {
      const now = Date.now();
      const timedOutIds: string[] = [];

      for (const [id, lastTime] of Object.entries(lastChunkReceivedAtRef.current)) {
        if (streamingStatuses[id] === 'receiving' && now - lastTime > 30000) {
          timedOutIds.push(id);
        }
      }

      for (const id of timedOutIds) {
        console.warn(`[gptviewer] Stream timed out for ${id}. Triggering fallback refresh.`);
        delete lastChunkReceivedAtRef.current[id];
        setStreamingStatuses((prev) => ({ ...prev, [id]: 'idle' }));
        // Only refresh if it's still in the conversation list
        const convo = conversations.find(c => c.id === id);
        if (convo) {
          handleRefreshConversationById(id);
        }
      }
    }, 2000);

    return () => {
      removeStatusListener?.();
      removeStreamListener?.();
      clearInterval(intervalId);
    };
  }, [conversations, streamingStatuses]);

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

  const handleRefreshConversationById = async (targetConversationId: string) => {
    const conversationToRefresh = conversations.find(c => c.id === targetConversationId);
    if (!isRefreshableSharedConversation(conversationToRefresh) || !targetConversationId || refreshingConversationId === targetConversationId) return;

    setRefreshError('');
    setRefreshingConversationId(targetConversationId);
    try {
      const refreshRequest = conversationToRefresh.refreshRequest ?? {
        conversationTitle: conversationToRefresh.title,
        helperWindowMode: 'background',
        mode: isChatUrlImportedConversation(conversationToRefresh)
          ? 'direct-chat-page'
          : 'direct-share-page',
        shareUrl: conversationToRefresh.sourceUrl,
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

  const handleRefreshActiveConversation = async () => {
    if (!activeConversation) return;
    await handleRefreshConversationById(activeConversation.id);
  };

  useEffect(() => {
    const fetchModelConfig = async () => {
      try {
        const config = await window.electronAPI?.getChatGptModelConfig();
        if (config && Object.keys(config).length > 0) {
          setModelConfig(config);
          localStorage.setItem('gptviewer-cached-model-config', JSON.stringify(config));
        }
      } catch (e) {
        console.error('Failed to fetch model config:', e);
      }
    };

    // Fetch immediately, then poll every 10 seconds (faster sync on startup)
    fetchModelConfig();
    const interval = setInterval(fetchModelConfig, 10000); 
    return () => clearInterval(interval);
  }, []);

  const handleModelChange = (model: string) => {
    setSelectedModel(model);
    localStorage.setItem('gptviewer-selected-model', model);
  };

  const handleSendMessageToActiveConversation = async (message: string, webSearch?: boolean) => {
    const currentStatus = activeConversation ? (streamingStatuses[activeConversation.id] || 'idle') : 'idle';
    if (!activeConversation || currentStatus !== 'idle') return;

    const chatUrl = activeConversation.refreshRequest?.chatUrl ||
                   (isChatUrlImportedConversation(activeConversation) ? activeConversation.sourceUrl : null);

    if (!chatUrl) {
      setRefreshError('메시지를 보낼 원본 ChatGPT 링크가 없습니다. 새로고침 설정에서 원본 링크를 연결해 주세요.');
      return;
    }

    setStreamingStatuses((prev) => ({ ...prev, [activeConversation.id]: 'sending' }));
    setRefreshError('');

    // Optimistically add user message and streaming placeholder
    const userMessage: Message = {
      id: `local-user-${Date.now()}`,
      role: 'user',
      sources: [],
      text: message,
      timestamp: new Date().toISOString(),
    };
    const assistantPlaceholder: Message = {
      id: 'streaming-placeholder',
      role: 'assistant',
      sources: [],
      text: '',
      timestamp: new Date().toISOString(),
    };

    setConversations((current) =>
      current.map((convo) =>
        convo.id === activeConversation.id
          ? { ...convo, messages: [...convo.messages, userMessage, assistantPlaceholder] }
          : convo,
      ),
    );

    try {
      const refreshRequest = activeConversation.refreshRequest ?? {
        chatUrl,
        conversationTitle: activeConversation.title,
        helperWindowMode: 'background',
        mode: 'direct-chat-page',
        shareUrl: activeConversation.sourceUrl,
      };

      // API call initiates with selected model and conversation ID
      const result = await window.electronAPI?.sendMessageToSharedConversation(
        refreshRequest,
        message,
        selectedModel === 'auto' ? undefined : selectedModel,
        activeConversation.id,
        webSearch
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
      // Revert placeholders on error by triggering a full refresh
      void handleRefreshActiveConversation();
    } finally {
      setStreamingStatuses((prev) => ({ ...prev, [activeConversation.id]: 'idle' }));
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
    sendMessageStatus: activeConversation ? (streamingStatuses[activeConversation.id] || 'idle') : 'idle',
    streamingStatuses,
    modelConfig,
    selectedModel,
    onModelChange: handleModelChange,
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
