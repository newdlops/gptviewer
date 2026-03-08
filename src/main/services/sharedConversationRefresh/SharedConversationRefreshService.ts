import type {
  SharedConversationImport,
  SharedConversationRefreshRequest,
  SharedConversationRefreshResult,
} from '../../../shared/refresh/sharedConversationRefresh';
import { DirectChatConversationImportStrategy } from './strategies/DirectChatConversationImportStrategy';
import { ChatGptShareFlowRefreshStrategy } from './strategies/ChatGptShareFlowRefreshStrategy';
import { DirectSharedConversationRefreshStrategy } from './strategies/DirectSharedConversationRefreshStrategy';

const hasUsableSharedConversationUrl = (value: string): boolean => {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return false;
  }

  try {
    const parsedUrl = new URL(trimmedValue);
    return /^\/share\/(?!create\/?$|new\/?$)[^/]+/i.test(parsedUrl.pathname);
  } catch {
    return false;
  }
};

type SharedConversationLoader = (url: string) => Promise<SharedConversationImport>;

type SharedConversationRefreshServiceOptions = {
  loadSharedConversation: SharedConversationLoader;
};

export class SharedConversationRefreshService {
  private readonly chatGptShareFlowStrategy: ChatGptShareFlowRefreshStrategy;
  private readonly directChatConversationImportStrategy: DirectChatConversationImportStrategy;
  private readonly directRefreshStrategy: DirectSharedConversationRefreshStrategy;

  constructor({ loadSharedConversation }: SharedConversationRefreshServiceOptions) {
    this.chatGptShareFlowStrategy = new ChatGptShareFlowRefreshStrategy(loadSharedConversation);
    this.directChatConversationImportStrategy = new DirectChatConversationImportStrategy();
    this.directRefreshStrategy = new DirectSharedConversationRefreshStrategy(loadSharedConversation);
  }

  async refreshConversation(
    request: SharedConversationRefreshRequest,
  ): Promise<SharedConversationRefreshResult> {
    if (!request.shareUrl.trim()) {
      throw new Error('새로고침할 공유 링크가 없습니다.');
    }

    if (request.mode === 'chatgpt-share-flow') {
      return this.chatGptShareFlowStrategy.refresh(request);
    }

    if (
      request.mode === 'direct-chat-page' ||
      (!!request.chatUrl && !hasUsableSharedConversationUrl(request.shareUrl))
    ) {
      const conversation =
        await this.directChatConversationImportStrategy.importFromChatUrl(request);
      const resolvedShareUrl = conversation.sourceUrl || request.chatUrl || request.shareUrl;

      return {
        ...conversation,
        refreshedAt: new Date().toISOString(),
        refreshRequest: {
          chatUrl: request.chatUrl,
          conversationTitle: request.conversationTitle ?? conversation.title,
          mode: 'direct-chat-page',
          projectUrl: request.projectUrl,
          shareUrl: resolvedShareUrl,
        },
        resolvedShareUrl,
        strategy: 'direct-chat-page',
      };
    }

    return this.directRefreshStrategy.refresh({
      ...request,
      mode: 'direct-share-page',
    });
  }

  async importConversationFromChatUrl(
    request: SharedConversationRefreshRequest,
  ): Promise<SharedConversationImport> {
    return this.directChatConversationImportStrategy.importFromChatUrl(request);
  }
}
