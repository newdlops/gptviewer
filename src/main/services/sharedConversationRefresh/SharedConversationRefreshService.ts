import type {
  SharedConversationImport,
  SharedConversationRefreshRequest,
  SharedConversationRefreshResult,
} from '../../../shared/refresh/sharedConversationRefresh';
import { DirectChatConversationImportStrategy } from './strategies/DirectChatConversationImportStrategy';
import { ChatGptShareFlowRefreshStrategy } from './strategies/ChatGptShareFlowRefreshStrategy';
import { DirectSharedConversationRefreshStrategy } from './strategies/DirectSharedConversationRefreshStrategy';
import { runWithLoginResume } from './chatgpt/chatGptLoginState';
import { SharedConversationRefreshError } from './SharedConversationRefreshError';

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

  async sendMessageToConversation(
    request: SharedConversationRefreshRequest,
    message: string,
  ): Promise<SharedConversationRefreshResult> {
    if (!request.chatUrl) {
      throw new SharedConversationRefreshError('chat_url_missing', '대화를 보낼 원본 링크가 없습니다.');
    }

    console.info(`[gptviewer] sendMessageToConversation initiated for URL: ${request.chatUrl}`);

    const result = await runWithLoginResume({
      initialMode: 'background', // Like import, run in background by default
      runAttempt: async (automationView) => {
        console.info('[gptviewer] Enabling network monitoring...');
        // We enable it first so we can observe initial requests and capture auth headers
        await automationView.enableConversationNetworkMonitoring().catch(() => {});

        console.info(`[gptviewer] Loading URL in automation view: ${request.chatUrl}`);
        await automationView.load(request.chatUrl!);
        
        console.info('[gptviewer] Waiting for page to settle before sending message...');
        await new Promise((resolve) => setTimeout(resolve, 3000));


        console.info('[gptviewer] Attempting to send message via script...');
        const sendResult = await automationView.sendMessage(message);
        console.info(`[gptviewer] Send message result: ${JSON.stringify(sendResult)}`);
        
        if (!sendResult.success) {
          throw new SharedConversationRefreshError('unknown', `메시지 전송 실패: ${sendResult.error || '알 수 없는 오류'}`);
        }

        // Wait for completion (our improved logic that checks network and visibility)
        console.info('[gptviewer] Waiting for ChatGPT response to complete...');
        const completionResult = await automationView.waitForResponseCompletion();
        console.info(`[gptviewer] Wait for response completion finished. Result: ${completionResult}`);

        console.info('[gptviewer] Proceeding to refresh conversation data after sending message...');
        return this.refreshConversation({
          ...request,
          mode: 'direct-chat-page',
        });
      },
    });

    console.info('[gptviewer] sendMessageToConversation fully completed.');
    return result as SharedConversationRefreshResult;
  }
}
