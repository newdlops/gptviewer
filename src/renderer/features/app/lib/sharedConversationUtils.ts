import type {
  SharedConversationRefreshMode,
  SharedConversationRefreshRequest,
} from '../../../../shared/refresh/sharedConversationRefresh';
import { formatClockLabel, normalizeImportedConversation } from '../../conversations/lib/normalizers';
import type { Conversation } from '../../../types/chat';

const normalizeChatGptUrl = (value: string): string | null => {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  try {
    const parsedUrl = new URL(trimmedValue);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return null;
    }
    if (!['chatgpt.com', 'chat.openai.com', 'www.chatgpt.com'].includes(parsedUrl.hostname)) {
      return null;
    }
    return parsedUrl.toString();
  } catch {
    return null;
  }
};

export const normalizeChatUrl = (value: string) => normalizeChatGptUrl(value);

export const normalizeProjectUrl = (value: string) => normalizeChatGptUrl(value);

export const hasUsableSharedConversationUrl = (value?: string): boolean => {
  const normalizedUrl = normalizeChatGptUrl(value || '');
  if (!normalizedUrl) {
    return false;
  }

  try {
    const parsedUrl = new URL(normalizedUrl);
    return /^\/share\/(?!create\/?$|new\/?$)[^/]+/i.test(parsedUrl.pathname);
  } catch {
    return false;
  }
};

export const isChatUrlImportedConversation = (
  conversation: Conversation | null,
): boolean => {
  if (!conversation) {
    return false;
  }

  if (conversation.importOrigin === 'chat-url') {
    return true;
  }

  return !hasUsableSharedConversationUrl(conversation.refreshRequest?.shareUrl);
};

export const buildRefreshRequest = (
  shareUrl: string,
  title: string,
  chatUrlValue: string,
  projectUrlValue: string,
  preferredMode?: SharedConversationRefreshMode,
): SharedConversationRefreshRequest => {
  const normalizedShareUrl = normalizeChatGptUrl(shareUrl) ?? shareUrl.trim();
  const normalizedChatUrl = normalizeChatUrl(chatUrlValue);
  const normalizedProjectUrl = normalizeProjectUrl(projectUrlValue);

  if (preferredMode === 'direct-chat-page') {
    return {
      chatUrl: normalizedChatUrl ?? undefined,
      conversationTitle: title,
      helperWindowMode: 'background',
      mode: 'direct-chat-page',
      projectUrl: normalizedProjectUrl ?? undefined,
      shareUrl: normalizedChatUrl ?? normalizedShareUrl,
    };
  }

  if (
    preferredMode === 'chatgpt-share-flow' ||
    (normalizedChatUrl && hasUsableSharedConversationUrl(normalizedShareUrl))
  ) {
    return {
      chatUrl: normalizedChatUrl ?? undefined,
      conversationTitle: title,
      helperWindowMode: 'background',
      mode: 'chatgpt-share-flow',
      projectUrl: normalizedProjectUrl ?? undefined,
      shareUrl: normalizedShareUrl,
    };
  }

  if (normalizedChatUrl) {
    return {
      chatUrl: normalizedChatUrl,
      conversationTitle: title,
      helperWindowMode: 'background',
      mode: 'direct-chat-page',
      projectUrl: normalizedProjectUrl ?? undefined,
      shareUrl: normalizedChatUrl,
    };
  }

  return {
    conversationTitle: title,
    helperWindowMode: 'background',
    mode: 'direct-share-page',
    projectUrl: normalizedProjectUrl ?? undefined,
    shareUrl: normalizedShareUrl,
  };
};

export const buildConversationFromImport = (
  conversationId: string,
  importedConversation: NonNullable<ReturnType<typeof normalizeImportedConversation>>,
): Conversation => ({
  fetchedAt: importedConversation.fetchedAt,
  id: conversationId,
  importOrigin: importedConversation.importOrigin,
  isSharedImport: true,
  messages: importedConversation.messages.map((message, index) => ({
    id: `${conversationId}-${index + 1}`,
    role: message.role,
    sources: message.sources,
    text: message.text,
    timestamp: formatClockLabel(importedConversation.fetchedAt),
  })),
  refreshRequest:
    importedConversation.refreshRequest ?? {
      conversationTitle: importedConversation.title,
      helperWindowMode: 'background',
      mode:
        importedConversation.importOrigin === 'chat-url'
          ? 'direct-chat-page'
          : 'direct-share-page',
      shareUrl: importedConversation.sourceUrl,
    },
  sourceUrl: importedConversation.sourceUrl,
  summary: importedConversation.summary,
  title: importedConversation.title,
  updatedAt: '방금 전',
});
