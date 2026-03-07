import type {
  SharedConversationImport,
  SharedConversationRefreshRequest,
  SharedConversationRefreshResult,
} from '../../../../shared/refresh/sharedConversationRefresh';

type SharedConversationLoader = (url: string) => Promise<SharedConversationImport>;

export class DirectSharedConversationRefreshStrategy {
  readonly mode = 'direct-share-page' as const;

  constructor(private readonly loadSharedConversation: SharedConversationLoader) {}

  async refresh(
    request: SharedConversationRefreshRequest,
  ): Promise<SharedConversationRefreshResult> {
    const conversation = await this.loadSharedConversation(request.shareUrl);
    const resolvedShareUrl = conversation.sourceUrl || request.shareUrl;

    return {
      ...conversation,
      refreshedAt: new Date().toISOString(),
      refreshRequest: {
        chatUrl: request.chatUrl,
        conversationTitle: request.conversationTitle ?? conversation.title,
        mode: this.mode,
        projectUrl: request.projectUrl,
        shareUrl: resolvedShareUrl,
      },
      resolvedShareUrl,
      strategy: this.mode,
    };
  }
}
