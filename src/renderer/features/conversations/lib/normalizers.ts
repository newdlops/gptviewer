import type {
  ChatRole,
  ImportedConversation,
  MessageSource,
  SourcePreview,
} from '../../../types/chat';
import type { SharedConversationRefreshRequest } from '../../../../shared/refresh/sharedConversationRefresh';

export const formatClockLabel = (value: string | number | Date): string =>
  new Date(value).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });

const normalizeMessageSources = (value: unknown): MessageSource[] =>
  Array.isArray(value)
    ? value
        .map((source) => {
          if (!source || typeof source !== 'object') {
            return null;
          }

          const sourceRecord = source as Record<string, unknown>;
          const title =
            typeof sourceRecord.title === 'string' ? sourceRecord.title.trim() : '';
          const url =
            typeof sourceRecord.url === 'string' ? sourceRecord.url.trim() : '';
          const attribution =
            typeof sourceRecord.attribution === 'string' &&
            sourceRecord.attribution.trim()
              ? sourceRecord.attribution.trim()
              : undefined;
          const description =
            typeof sourceRecord.description === 'string' &&
            sourceRecord.description.trim()
              ? sourceRecord.description.trim()
              : undefined;
          const iconUrl =
            typeof sourceRecord.iconUrl === 'string' && sourceRecord.iconUrl.trim()
              ? sourceRecord.iconUrl.trim()
              : undefined;
          const publisher =
            typeof sourceRecord.publisher === 'string' &&
            sourceRecord.publisher.trim()
              ? sourceRecord.publisher.trim()
              : undefined;

          if (!title || !url) {
            return null;
          }

          const normalizedSource: MessageSource = {
            title,
            url,
          };

          if (attribution) {
            normalizedSource.attribution = attribution;
          }
          if (description) {
            normalizedSource.description = description;
          }
          if (iconUrl) {
            normalizedSource.iconUrl = iconUrl;
          }
          if (publisher) {
            normalizedSource.publisher = publisher;
          }

          return normalizedSource;
        })
        .filter((source): source is MessageSource => !!source)
    : [];

export const normalizeImportedConversation = (
  value: unknown,
): ImportedConversation | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const messages = Array.isArray(record.messages)
    ? record.messages
        .map((message) => {
          if (!message || typeof message !== 'object') {
            return null;
          }

          const messageRecord = message as Record<string, unknown>;
          const role =
            messageRecord.role === 'assistant' || messageRecord.role === 'user'
              ? messageRecord.role
              : null;
          const text =
            typeof messageRecord.text === 'string' ? messageRecord.text.trim() : '';

          if (!role || !text) {
            return null;
          }

          return {
            role,
            sources: normalizeMessageSources(messageRecord.sources),
            text,
          };
        })
        .filter(
          (
            message,
          ): message is {
            role: ChatRole;
            sources: MessageSource[];
            text: string;
          } => !!message,
        )
    : [];

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

  return {
    fetchedAt:
      typeof record.fetchedAt === 'string'
        ? record.fetchedAt
        : new Date().toISOString(),
    messages,
    refreshRequest: normalizeRefreshRequest(record.refreshRequest),
    sourceUrl: typeof record.sourceUrl === 'string' ? record.sourceUrl : '',
    summary: typeof record.summary === 'string' ? record.summary : '',
    title: typeof record.title === 'string' ? record.title : '공유 대화',
  };
};

export const normalizeSourcePreview = (value: unknown): SourcePreview | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const url = typeof record.url === 'string' ? record.url.trim() : '';

  if (!url) {
    return null;
  }

  return {
    description:
      typeof record.description === 'string' && record.description.trim()
        ? record.description.trim()
        : undefined,
    iconHref:
      typeof record.iconHref === 'string' && record.iconHref.trim()
        ? record.iconHref.trim()
        : undefined,
    iconUrl:
      typeof record.iconUrl === 'string' && record.iconUrl.trim()
        ? record.iconUrl.trim()
        : undefined,
    publisher:
      typeof record.publisher === 'string' && record.publisher.trim()
        ? record.publisher.trim()
        : undefined,
    title:
      typeof record.title === 'string' && record.title.trim()
        ? record.title.trim()
        : undefined,
    url,
  };
};
