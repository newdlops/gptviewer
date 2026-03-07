import type {
  SharedConversationImport,
  SharedConversationRefreshRequest,
  SharedConversationRefreshResult,
} from '../../../shared/refresh/sharedConversationRefresh';
import { ChatGptShareFlowRefreshStrategy } from './strategies/ChatGptShareFlowRefreshStrategy';
import { DirectSharedConversationRefreshStrategy } from './strategies/DirectSharedConversationRefreshStrategy';

type SharedConversationLoader = (url: string) => Promise<SharedConversationImport>;

type SharedConversationRefreshServiceOptions = {
  loadSharedConversation: SharedConversationLoader;
};

export class SharedConversationRefreshService {
  private readonly chatGptShareFlowStrategy: ChatGptShareFlowRefreshStrategy;
  private readonly directRefreshStrategy: DirectSharedConversationRefreshStrategy;

  constructor({ loadSharedConversation }: SharedConversationRefreshServiceOptions) {
    this.chatGptShareFlowStrategy = new ChatGptShareFlowRefreshStrategy(loadSharedConversation);
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

    return this.directRefreshStrategy.refresh({
      ...request,
      mode: 'direct-share-page',
    });
  }
}
