import type {
  ProjectConversationImportConversation,
  ProjectConversationImportFailure,
  ProjectConversationImportResult,
} from '../../../shared/import/projectConversationImport';
import type {
  SharedConversationRefreshRequest,
  SharedConversationRefreshResult,
} from '../../../shared/refresh/sharedConversationRefresh';
import { CHATGPT_CHALLENGE_TEXT_MARKERS, CHATGPT_LOGIN_TEXT_MARKERS, CHATGPT_LOGIN_URL_PATTERNS, CHATGPT_PROJECT_CHAT_LIST_SELECTORS } from '../sharedConversationRefresh/chatgpt/ChatGptDomSelectors';
import { ChatGptAutomationView } from '../sharedConversationRefresh/chatgpt/ChatGptAutomationView';
import { waitForConversationListReady } from '../sharedConversationRefresh/chatgpt/chatGptConversationLoadHelpers';
import { includesMarker } from '../sharedConversationRefresh/chatgpt/chatGptRefreshHelpers';
import {
  buildCollectProjectConversationListSnapshotScript,
  buildScrollProjectConversationListScript,
  type ProjectConversationListSnapshot,
} from './chatgpt/chatGptProjectImportScripts';
import { SharedConversationRefreshError } from '../sharedConversationRefresh/SharedConversationRefreshError';

type ProjectConversationRefresh = (
  request: SharedConversationRefreshRequest,
) => Promise<SharedConversationRefreshResult>;

const PROJECT_LIST_COLLECTION_TIMEOUT_MS = 18_000;
const PROJECT_LIST_POLL_INTERVAL_MS = 180;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isLoginLikeSnapshot = (
  snapshot: Awaited<ReturnType<ChatGptAutomationView['getPageSnapshot']>>,
) => {
  const isLoginUrl = CHATGPT_LOGIN_URL_PATTERNS.some((pattern) =>
    pattern.test(snapshot.currentUrl),
  );
  return (
    isLoginUrl ||
    includesMarker(snapshot.bodyText, CHATGPT_LOGIN_TEXT_MARKERS) ||
    includesMarker(snapshot.bodyText, CHATGPT_CHALLENGE_TEXT_MARKERS)
  );
};

const normalizeProjectUrl = (rawUrl: string) => {
  const trimmedUrl = rawUrl.trim();
  if (!trimmedUrl) {
    throw new Error('프로젝트 URL을 입력해 주세요.');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    throw new Error('올바른 프로젝트 URL 형식이 아닙니다.');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('http 또는 https 프로젝트 URL만 불러올 수 있습니다.');
  }

  if (!['chatgpt.com', 'www.chatgpt.com', 'chat.openai.com'].includes(parsedUrl.hostname)) {
    throw new Error('ChatGPT 프로젝트 URL만 불러올 수 있습니다.');
  }

  return parsedUrl.toString();
};

const shouldAbortImport = (error: unknown) =>
  error instanceof SharedConversationRefreshError &&
  ['login_required', 'window_closed'].includes(error.code);

export class ProjectConversationImportService {
  constructor(
    private readonly refreshSharedConversation: ProjectConversationRefresh,
  ) {}

  private async collectProjectConversations(
    projectUrl: string,
  ): Promise<ProjectConversationListSnapshot> {
    const automationView = ChatGptAutomationView.acquire();
    try {
      await automationView.load(projectUrl);
      const firstSnapshot = await automationView.getPageSnapshot();
      if (isLoginLikeSnapshot(firstSnapshot)) {
        throw new Error('ChatGPT 로그인 또는 보안 확인이 필요합니다. 보조 창에서 먼저 마친 뒤 다시 시도해 주세요.');
      }

      const isListReady = await waitForConversationListReady(
        automationView,
        CHATGPT_PROJECT_CHAT_LIST_SELECTORS,
        10_000,
        120,
      );
      if (!isListReady) {
        throw new Error('프로젝트의 채팅 목록을 찾지 못했습니다.');
      }

      const deadline = Date.now() + PROJECT_LIST_COLLECTION_TIMEOUT_MS;
      const collected = new Map<string, { chatUrl: string; title: string }>();
      let projectTitle = '프로젝트';
      let stalledCount = 0;

      while (Date.now() < deadline && !automationView.isClosed()) {
        const snapshot = await automationView.execute<ProjectConversationListSnapshot>(
          buildCollectProjectConversationListSnapshotScript(
            CHATGPT_PROJECT_CHAT_LIST_SELECTORS,
          ),
        );
        if (snapshot.projectTitle.trim()) {
          projectTitle = snapshot.projectTitle.trim();
        }

        const previousCount = collected.size;
        snapshot.conversations.forEach((conversation) => {
          collected.set(conversation.chatUrl, conversation);
        });
        stalledCount = collected.size === previousCount ? stalledCount + 1 : 0;

        if (!snapshot.canScrollMore && stalledCount >= 1) {
          break;
        }

        const didScroll = await automationView.execute<boolean>(
          buildScrollProjectConversationListScript(
            CHATGPT_PROJECT_CHAT_LIST_SELECTORS,
          ),
        );
        if (!didScroll && stalledCount >= 2) {
          break;
        }

        await sleep(PROJECT_LIST_POLL_INTERVAL_MS);
      }

      if (automationView.isClosed()) {
        throw new Error('프로젝트 불러오기 중 보조 ChatGPT 창이 닫혔습니다.');
      }

      return {
        canScrollMore: false,
        conversations: Array.from(collected.values()),
        projectTitle,
      };
    } finally {
      await automationView.close();
    }
  }

  async importProject(projectUrlValue: string): Promise<ProjectConversationImportResult> {
    const projectUrl = normalizeProjectUrl(projectUrlValue);
    const collectedProject = await this.collectProjectConversations(projectUrl);

    if (collectedProject.conversations.length === 0) {
      throw new Error('프로젝트에서 불러올 대화를 찾지 못했습니다.');
    }

    const conversations: ProjectConversationImportConversation[] = [];
    const failures: ProjectConversationImportFailure[] = [];

    for (const conversation of collectedProject.conversations) {
      try {
        const importedConversation = await this.refreshSharedConversation({
          chatUrl: conversation.chatUrl,
          conversationTitle: conversation.title,
          mode: 'chatgpt-share-flow',
          projectUrl,
          shareUrl: conversation.chatUrl,
        });
        conversations.push({
          ...importedConversation,
          chatUrl: conversation.chatUrl,
        });
      } catch (error) {
        if (shouldAbortImport(error)) {
          throw error;
        }
        failures.push({
          chatUrl: conversation.chatUrl,
          message:
            error instanceof Error
              ? error.message
              : '대화를 불러오지 못했습니다.',
          title: conversation.title,
        });
      }
    }

    if (conversations.length === 0) {
      throw new Error(
        failures[0]?.message ?? '프로젝트 대화를 불러오지 못했습니다.',
      );
    }

    return {
      conversations,
      failures,
      fetchedAt: new Date().toISOString(),
      projectTitle: collectedProject.projectTitle || '프로젝트',
      projectUrl,
    };
  }
}
