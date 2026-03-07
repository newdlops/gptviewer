import { clipboard } from 'electron';
import type {
  SharedConversationImport,
  SharedConversationRefreshRequest,
  SharedConversationRefreshResult,
} from '../../../../shared/refresh/sharedConversationRefresh';
import { ChatGptAutomationView } from '../chatgpt/ChatGptAutomationView';
import { openShareEntryPointFromDirectConversation } from '../chatgpt/chatGptDirectConversationNavigation';
import {
  resolveRefreshedShareUrl,
  waitForShareCopyResolution,
  waitForShareModalOpen,
} from '../chatgpt/chatGptRefreshHelpers';
import {
  openShareEntryPointFromProject,
} from '../chatgpt/chatGptConversationNavigation';
import { SharedConversationRefreshError } from '../SharedConversationRefreshError';

type SharedConversationLoader = (url: string) => Promise<SharedConversationImport>;

export class ChatGptShareFlowRefreshStrategy {
  readonly mode = 'chatgpt-share-flow' as const;

  constructor(private readonly loadSharedConversation: SharedConversationLoader) {}

  async refresh(
    request: SharedConversationRefreshRequest,
  ): Promise<SharedConversationRefreshResult> {
    if (!request.chatUrl) {
      throw new SharedConversationRefreshError(
        'chat_url_missing',
        '원본 ChatGPT 대화 URL이 없어 자동 새로고침을 수행할 수 없습니다. 새로고침 설정에서 ChatGPT 대화 URL을 연결해 주세요.',
      );
    }

    const automationView = ChatGptAutomationView.acquire();

    try {
      clipboard.clear();
      await automationView.load(request.projectUrl ?? request.chatUrl ?? 'https://chatgpt.com/');
      const shareEntryPointResult = request.projectUrl
        ? await openShareEntryPointFromProject(
            automationView,
            request.projectUrl,
            request.chatUrl,
          )
        : await openShareEntryPointFromDirectConversation(
            automationView,
            request.chatUrl,
          );
      if (shareEntryPointResult.status === 'login_required') {
        throw new SharedConversationRefreshError(
          'login_required',
          'ChatGPT 로그인 또는 보안 확인이 끝나지 않았습니다. 보조 창에서 마친 뒤 다시 시도해 주세요.',
          shareEntryPointResult.detail,
        );
      }
      if (shareEntryPointResult.status === 'window_closed') {
        throw new SharedConversationRefreshError(
          'window_closed',
          '보조 ChatGPT 창이 닫혀 새로고침을 중단했습니다.',
          shareEntryPointResult.detail,
        );
      }
      if (shareEntryPointResult.status === 'share_button_not_found') {
        throw new SharedConversationRefreshError(
          'share_button_not_found',
          'ChatGPT 공유 버튼을 찾지 못했습니다. GPT 웹앱 구조가 바뀌었거나 현재 대화 화면이 완전히 열리지 않았을 수 있습니다.',
          shareEntryPointResult.detail,
        );
      }

      const shareModalState = await waitForShareModalOpen(automationView, 100);
      if (shareModalState === 'window_closed') {
        throw new SharedConversationRefreshError(
          'window_closed',
          '보조 ChatGPT 창이 닫혀 새로고침을 중단했습니다.',
        );
      }
      if (shareModalState !== 'opened') {
        const snapshot = await automationView.getPageSnapshot();
        throw new SharedConversationRefreshError(
          'share_button_not_found',
          '공유하기를 눌렀지만 공유 모달이 열리지 않았습니다. 보조 창에서 모달 표시 상태를 확인해 주세요.',
          `${snapshot.currentUrl}\nvisible actions: ${snapshot.actionLabels.join(' | ')}`,
        );
      }

      const shareCopyResolution = await waitForShareCopyResolution(automationView);
      if (shareCopyResolution.status === 'window_closed') {
        throw new SharedConversationRefreshError(
          'window_closed',
          '보조 ChatGPT 창이 닫혀 새로고침을 중단했습니다.',
        );
      }
      if (shareCopyResolution.status !== 'copied') {
        const snapshot = await automationView.getPageSnapshot();
        throw new SharedConversationRefreshError(
          'share_update_button_not_found',
          '공유 링크 갱신 버튼이 활성화되지 않았습니다. 보조 창에서 공유 모달 상태를 확인해 주세요.',
          `${snapshot.currentUrl}\nvisible actions: ${snapshot.actionLabels.join(' | ')}`,
        );
      }

      const refreshedShareUrl =
        shareCopyResolution.shareUrl ?? (await resolveRefreshedShareUrl(automationView));
      if (!refreshedShareUrl) {
        const shareUrlFromModal = await automationView.waitForSharedUrlCandidate(3_000, 200);
        if (shareUrlFromModal) {
          const conversation = await this.loadSharedConversation(shareUrlFromModal);
          return {
            ...conversation,
            refreshedAt: new Date().toISOString(),
            refreshRequest: {
              chatUrl: request.chatUrl,
              conversationTitle: request.conversationTitle ?? conversation.title,
              mode: this.mode,
              projectUrl: request.projectUrl,
              shareUrl: shareUrlFromModal,
            },
            resolvedShareUrl: shareUrlFromModal,
            strategy: this.mode,
          };
        }
        const snapshot = await automationView.getPageSnapshot();
        throw new SharedConversationRefreshError(
          'clipboard_read_failed',
          '갱신된 공유 링크를 자동으로 읽지 못했습니다. 보조 창의 Share 모달에서 링크 입력칸이나 복사 결과가 실제로 보이는지 확인해 주세요.',
          snapshot.currentUrl,
        );
      }

      const conversation = await this.loadSharedConversation(refreshedShareUrl);
      return {
        ...conversation,
        refreshedAt: new Date().toISOString(),
        refreshRequest: {
          chatUrl: request.chatUrl,
          conversationTitle: request.conversationTitle ?? conversation.title,
          mode: this.mode,
          projectUrl: request.projectUrl,
          shareUrl: refreshedShareUrl,
        },
        resolvedShareUrl: refreshedShareUrl,
        strategy: this.mode,
      };
    } catch (error) {
      if (error instanceof SharedConversationRefreshError) {
        throw error;
      }
      throw new SharedConversationRefreshError(
        'unknown',
        error instanceof Error ? error.message : 'ChatGPT 자동 새로고침에 실패했습니다.',
      );
    } finally {
      await automationView.close();
    }
  }
}
