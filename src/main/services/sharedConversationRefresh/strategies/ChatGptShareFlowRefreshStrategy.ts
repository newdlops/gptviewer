import { clipboard } from 'electron';
import type {
  SharedConversationImport,
  SharedConversationRefreshRequest,
  SharedConversationRefreshResult,
} from '../../../../shared/refresh/sharedConversationRefresh';
import { ChatGptAutomationView } from '../chatgpt/ChatGptAutomationView';
import {
  buildLoginRequiredDetail,
  ensureLoginAttentionIfNeeded,
  runWithLoginResume,
} from '../chatgpt/chatGptLoginState';
import { openShareEntryPointFromDirectConversation } from '../chatgpt/chatGptDirectConversationNavigation';
import {
  closeShareModal,
  readSharedUrlFromClipboard,
  waitForShareCopyResolution,
  waitForShareModalOpen,
} from '../chatgpt/chatGptRefreshHelpers';
import { ChatGptRefreshDiagnostics } from '../chatgpt/chatGptRefreshDiagnostics';
import {
  openShareEntryPointFromProject,
} from '../chatgpt/chatGptConversationNavigation';
import { SharedConversationRefreshError } from '../SharedConversationRefreshError';

type SharedConversationLoader = (url: string) => Promise<SharedConversationImport>;
const SHARE_MODAL_IDLE_TIMEOUTS_MS = [5_000, 10_000, 15_000];
const SHARE_REFRESH_PROPAGATION_DELAY_MS = 2_000;
const SHARE_PAGE_READY_RETRY_DELAYS_MS = [1_500, 2_500, 4_000];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const uniqueShareUrls = (primaryUrl: string, fallbackUrl?: string) =>
  [...new Set([primaryUrl, fallbackUrl].filter((value): value is string => Boolean(value && value.trim())))];

const isRetryableShareLoadError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /\((403|404)\)/.test(message) || message.includes('공유 페이지에서 대화 내용을 찾지 못했습니다.');
};

export class ChatGptShareFlowRefreshStrategy {
  readonly mode = 'chatgpt-share-flow' as const;

  constructor(private readonly loadSharedConversation: SharedConversationLoader) {}

  private async loadRefreshedConversationWithRetry(
    shareUrls: string[],
    diagnostics: ChatGptRefreshDiagnostics,
  ) {
    let lastError: unknown = null;
    for (const shareUrl of shareUrls) {
      try {
        diagnostics.record('share-load', `url=${shareUrl} attempt=1`);
        return await this.loadSharedConversation(shareUrl);
      } catch (error) {
        if (!isRetryableShareLoadError(error)) throw error;
        lastError = error;
        diagnostics.record(
          'share-load',
          `url=${shareUrl} attempt=1 failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      for (let attempt = 0; attempt < SHARE_PAGE_READY_RETRY_DELAYS_MS.length; attempt += 1) {
        const delayMs = SHARE_PAGE_READY_RETRY_DELAYS_MS[attempt];
        await sleep(delayMs);
        try {
          diagnostics.record(
            'share-load',
            `url=${shareUrl} attempt=${attempt + 2} after=${delayMs}ms`,
          );
          return await this.loadSharedConversation(shareUrl);
        } catch (error) {
          if (!isRetryableShareLoadError(error)) throw error;
          lastError = error;
          diagnostics.record(
            'share-load',
            `url=${shareUrl} attempt=${attempt + 2} failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    throw lastError ?? new Error('공유 대화를 다시 불러오는 중 예상치 못한 상태에 도달했습니다.');
  }

  async refresh(
    request: SharedConversationRefreshRequest,
  ): Promise<SharedConversationRefreshResult> {
    if (!request.chatUrl) {
      throw new SharedConversationRefreshError(
        'chat_url_missing',
        '원본 ChatGPT 대화 URL이 없어 자동 새로고침을 수행할 수 없습니다. 새로고침 설정에서 ChatGPT 대화 URL을 연결해 주세요.',
      );
    }

    return runWithLoginResume({
      initialMode: request.helperWindowMode ?? 'visible',
      runAttempt: async (automationView) =>
        this.refreshWithView(request, automationView),
    });
  }

  private async refreshWithView(
    request: SharedConversationRefreshRequest,
    automationView: ChatGptAutomationView,
  ): Promise<SharedConversationRefreshResult> {
    const diagnostics = new ChatGptRefreshDiagnostics();
    let automationViewClosed = false;
    const closeAutomationView = async () => {
      if (automationViewClosed) {
        return;
      }
      automationViewClosed = true;
      await automationView.close();
    };

    try {
      diagnostics.record('strategy', `start mode=${request.projectUrl ? 'project' : 'direct'}`);
      clipboard.clear();
      await automationView.load(request.projectUrl ?? request.chatUrl ?? 'https://chatgpt.com/');
      diagnostics.record('strategy', `loaded=${request.projectUrl ?? request.chatUrl ?? 'https://chatgpt.com/'}`);
      const loginSnapshot = await ensureLoginAttentionIfNeeded(automationView);
      if (loginSnapshot) {
        throw new SharedConversationRefreshError(
          'login_required',
          'ChatGPT 로그인 또는 보안 확인이 끝나지 않았습니다. 보조 창에서 마친 뒤 다시 시도해 주세요.',
          diagnostics.toDetail(buildLoginRequiredDetail(loginSnapshot)),
        );
      }
      let shareCopyResolution:
        | Awaited<ReturnType<typeof waitForShareCopyResolution>>
        | null = null;
      for (let attempt = 0; attempt < SHARE_MODAL_IDLE_TIMEOUTS_MS.length; attempt += 1) {
        diagnostics.record(
          'strategy',
          `attempt=${attempt + 1} idleTimeoutMs=${SHARE_MODAL_IDLE_TIMEOUTS_MS[attempt]}`,
        );
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
        diagnostics.record('share-entry', `status=${shareEntryPointResult.status}`);
        if (shareEntryPointResult.status === 'login_required') {
          await automationView.presentForAttention();
          throw new SharedConversationRefreshError(
            'login_required',
            'ChatGPT 로그인 또는 보안 확인이 끝나지 않았습니다. 보조 창에서 마친 뒤 다시 시도해 주세요.',
            diagnostics.toDetail(shareEntryPointResult.detail),
          );
        }
        if (shareEntryPointResult.status === 'window_closed') {
          throw new SharedConversationRefreshError(
            'window_closed',
            '보조 ChatGPT 창이 닫혀 새로고침을 중단했습니다.',
            diagnostics.toDetail(shareEntryPointResult.detail),
          );
        }
        if (shareEntryPointResult.status === 'share_button_not_found') {
          throw new SharedConversationRefreshError(
            'share_button_not_found',
            'ChatGPT 공유 버튼을 찾지 못했습니다. GPT 웹앱 구조가 바뀌었거나 현재 대화 화면이 완전히 열리지 않았을 수 있습니다.',
            diagnostics.toDetail(shareEntryPointResult.detail),
          );
        }

        const shareModalState = await waitForShareModalOpen(automationView, 100, diagnostics);
        diagnostics.record('share-modal-open', `status=${shareModalState}`);
        if (shareModalState === 'window_closed') {
          throw new SharedConversationRefreshError(
            'window_closed',
            '보조 ChatGPT 창이 닫혀 새로고침을 중단했습니다.',
            diagnostics.toDetail(),
          );
        }
        if (shareModalState !== 'opened') {
          const snapshot = await automationView.getPageSnapshot();
          throw new SharedConversationRefreshError(
            'share_button_not_found',
            '공유하기를 눌렀지만 공유 모달이 열리지 않았습니다. 보조 창에서 모달 표시 상태를 확인해 주세요.',
            diagnostics.toDetail(
              `${snapshot.currentUrl}\nvisible actions: ${snapshot.actionLabels.join(' | ')}`,
            ),
          );
        }

        shareCopyResolution = await waitForShareCopyResolution(
          automationView,
          250,
          SHARE_MODAL_IDLE_TIMEOUTS_MS[attempt],
          diagnostics,
        );
        diagnostics.record('share-copy', `status=${shareCopyResolution.status}`);
        if (shareCopyResolution.status === 'window_closed') {
          throw new SharedConversationRefreshError(
            'window_closed',
            '보조 ChatGPT 창이 닫혀 새로고침을 중단했습니다.',
            diagnostics.toDetail(),
          );
        }
        if (shareCopyResolution.status === 'copied') {
          break;
        }
        if (shareCopyResolution.status !== 'stalled') {
          continue;
        }
        if (attempt >= SHARE_MODAL_IDLE_TIMEOUTS_MS.length - 1) {
          break;
        }
        const closeShareModalResult = await closeShareModal(automationView);
        if (closeShareModalResult === 'window_closed') {
          throw new SharedConversationRefreshError(
            'window_closed',
            '보조 ChatGPT 창이 닫혀 새로고침을 중단했습니다.',
            diagnostics.toDetail(),
          );
        }
        if (closeShareModalResult !== 'closed') {
          const snapshot = await automationView.getPageSnapshot();
          throw new SharedConversationRefreshError(
            'share_update_button_not_found',
            '공유 모달이 멈춰 다시 열기를 시도했지만 모달을 닫지 못했습니다.',
            diagnostics.toDetail(
              `${snapshot.currentUrl}\nvisible actions: ${snapshot.actionLabels.join(' | ')}`,
            ),
          );
        }
      }
      if (!shareCopyResolution || shareCopyResolution.status !== 'copied') {
        const snapshot = await automationView.getPageSnapshot();
        throw new SharedConversationRefreshError(
          'share_update_button_not_found',
          '공유 모달이 5초, 10초, 15초 대기 후에도 반응하지 않아 링크 복사를 준비하지 못했습니다.',
          diagnostics.toDetail(
            `${snapshot.currentUrl}\nvisible actions: ${snapshot.actionLabels.join(' | ')}`,
          ),
        );
      }

      await closeAutomationView();
      const refreshedShareUrl =
        shareCopyResolution.shareUrl ??
        (await readSharedUrlFromClipboard(3_000));
      diagnostics.record('share-load', `resolvedShareUrl=${refreshedShareUrl ?? 'none'}`);
      if (!refreshedShareUrl) {
        throw new SharedConversationRefreshError(
          'clipboard_read_failed',
          '갱신된 공유 링크를 자동으로 읽지 못했습니다. 보조 창의 Share 모달에서 링크 입력칸이나 복사 결과가 실제로 보이는지 확인해 주세요.',
          diagnostics.toDetail(request.chatUrl),
        );
      }

      await sleep(SHARE_REFRESH_PROPAGATION_DELAY_MS);
      const conversation = await this.loadRefreshedConversationWithRetry(
        uniqueShareUrls(refreshedShareUrl, request.shareUrl),
        diagnostics,
      );
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
        diagnostics.toDetail(),
      );
    } finally {
      await closeAutomationView();
    }
  }
}
