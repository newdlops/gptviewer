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

export const buildRefreshRequest = (
  shareUrl: string,
  title: string,
  chatUrlValue: string,
  projectUrlValue: string,
  preferredMode?: SharedConversationRefreshMode,
): SharedConversationRefreshRequest => {
  const normalizedChatUrl = normalizeChatUrl(chatUrlValue);
  const normalizedProjectUrl = normalizeProjectUrl(projectUrlValue);
  if (preferredMode === 'chatgpt-share-flow' || normalizedChatUrl) {
    return {
      chatUrl: normalizedChatUrl ?? undefined,
      conversationTitle: title,
      mode: 'chatgpt-share-flow',
      projectUrl: normalizedProjectUrl ?? undefined,
      shareUrl,
    };
  }

  return {
    conversationTitle: title,
    mode: 'direct-share-page',
    projectUrl: normalizedProjectUrl ?? undefined,
    shareUrl,
  };
};

export const buildConversationFromImport = (
  conversationId: string,
  importedConversation: NonNullable<ReturnType<typeof normalizeImportedConversation>>,
): Conversation => ({
  fetchedAt: importedConversation.fetchedAt,
  id: conversationId,
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
      mode: 'direct-share-page',
      shareUrl: importedConversation.sourceUrl,
    },
  sourceUrl: importedConversation.sourceUrl,
  summary: importedConversation.summary,
  title: importedConversation.title,
  updatedAt: '방금 전',
});
