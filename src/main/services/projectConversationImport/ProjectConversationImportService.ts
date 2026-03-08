import type {
  ProjectConversationCollectionResult,
  ProjectConversationImportProgress,
} from '../../../shared/import/projectConversationImport';
import { CHATGPT_CHALLENGE_TEXT_MARKERS, CHATGPT_LOGIN_TEXT_MARKERS, CHATGPT_LOGIN_URL_PATTERNS, CHATGPT_PROJECT_CHAT_LIST_SELECTORS } from '../sharedConversationRefresh/chatgpt/ChatGptDomSelectors';
import { ChatGptAutomationView } from '../sharedConversationRefresh/chatgpt/ChatGptAutomationView';
import { waitForConversationListReady } from '../sharedConversationRefresh/chatgpt/chatGptConversationLoadHelpers';
import { includesMarker } from '../sharedConversationRefresh/chatgpt/chatGptRefreshHelpers';
import {
  buildCollectProjectConversationListSnapshotScript,
  buildScrollProjectConversationListScript,
  type ProjectConversationListSnapshot,
} from './chatgpt/chatGptProjectImportScripts';
import {
  buildInstallProjectImportNetworkMonitorScript,
  buildReadProjectImportNetworkStateScript,
  type ProjectImportNetworkState,
} from './chatgpt/chatGptProjectImportNetworkScripts';

const PROJECT_LIST_COLLECTION_TIMEOUT_MS = 20_000;
const PROJECT_LIST_STABLE_LINK_CYCLES = 3;
const PROJECT_LIST_POLL_INTERVAL_MS = 220;
const PROJECT_LIST_SETTLE_IDLE_MS = 2_000;
const PROJECT_LIST_SETTLE_TIMEOUT_MS = 12_000;

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

const mergeProjectConversationSnapshot = (
  collected: Map<string, { chatUrl: string; title: string }>,
  snapshot: ProjectConversationListSnapshot,
) => {
  snapshot.conversations.forEach((conversation) => {
    collected.set(conversation.chatUrl, conversation);
  });
};

export class ProjectConversationImportService {
  private async collectProjectConversations(
    projectUrl: string,
    onProgress?: (progress: ProjectConversationImportProgress) => void,
  ): Promise<ProjectConversationListSnapshot> {
    const automationView = await ChatGptAutomationView.acquire('background');
    try {
      await automationView.load(projectUrl);
      await automationView.execute<boolean>(
        buildInstallProjectImportNetworkMonitorScript(),
      );
      const firstSnapshot = await automationView.getPageSnapshot();
      if (isLoginLikeSnapshot(firstSnapshot)) {
        await automationView.presentForAttention();
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
      let stableLinkCount = 0;
      let lastConversationUrl = '';
      let lastListItemCount = -1;
      let lastCollectedCount = -1;
      let lastNetworkActivityAt = 0;
      let finalSnapshot: ProjectConversationListSnapshot | null = null;

      while (Date.now() < deadline && !automationView.isClosed()) {
        const snapshot = await automationView.execute<ProjectConversationListSnapshot>(
          buildCollectProjectConversationListSnapshotScript(
            CHATGPT_PROJECT_CHAT_LIST_SELECTORS,
          ),
        );
        const networkState = await automationView.execute<ProjectImportNetworkState>(
          buildReadProjectImportNetworkStateScript(),
        );
        if (snapshot.projectTitle.trim()) {
          projectTitle = snapshot.projectTitle.trim();
        }
        mergeProjectConversationSnapshot(collected, snapshot);
        finalSnapshot = snapshot;
        onProgress?.({
          collectedCount: collected.size,
          listItemCount: snapshot.listItemCount,
          phase: 'collecting',
          projectTitle,
        });

        const didChangeCollectedCount = collected.size !== lastCollectedCount;
        const didChangeList = snapshot.listItemCount !== lastListItemCount;
        const didChangeLastConversation =
          snapshot.lastConversationUrl !== lastConversationUrl;
        const didChangeNetworkActivity =
          networkState.lastActivityAt !== lastNetworkActivityAt;

        stableLinkCount =
          didChangeCollectedCount ||
          didChangeList ||
          didChangeLastConversation ||
          didChangeNetworkActivity
            ? 0
            : stableLinkCount + 1;

        if (collected.size > 0 && stableLinkCount >= PROJECT_LIST_STABLE_LINK_CYCLES) {
          break;
        }

        const didScroll = await automationView.execute<boolean>(
          buildScrollProjectConversationListScript(
            CHATGPT_PROJECT_CHAT_LIST_SELECTORS,
          ),
        );

        lastCollectedCount = collected.size;
        lastConversationUrl = snapshot.lastConversationUrl;
        lastListItemCount = snapshot.listItemCount;
        lastNetworkActivityAt = networkState.lastActivityAt;

        if (!didScroll && collected.size > 0 && stableLinkCount > 0) {
          break;
        }

        await sleep(PROJECT_LIST_POLL_INTERVAL_MS);
      }

      if (automationView.isClosed()) {
        throw new Error('프로젝트 불러오기 중 보조 ChatGPT 창이 닫혔습니다.');
      }

      let settleCollectedCount = collected.size;
      let settleListItemCount = finalSnapshot?.listItemCount ?? 0;
      let settleLastConversationUrl = finalSnapshot?.lastConversationUrl ?? '';
      let lastGrowthAt = Date.now();
      let lastSettledNetworkActivityAt = lastNetworkActivityAt;
      const settleDeadline = lastGrowthAt + PROJECT_LIST_SETTLE_TIMEOUT_MS;

      while (Date.now() < settleDeadline && !automationView.isClosed()) {
        await automationView.execute<boolean>(
          buildScrollProjectConversationListScript(
            CHATGPT_PROJECT_CHAT_LIST_SELECTORS,
          ),
        );
        await sleep(PROJECT_LIST_POLL_INTERVAL_MS);

        finalSnapshot = await automationView.execute<ProjectConversationListSnapshot>(
          buildCollectProjectConversationListSnapshotScript(
            CHATGPT_PROJECT_CHAT_LIST_SELECTORS,
          ),
        );
        const networkState = await automationView.execute<ProjectImportNetworkState>(
          buildReadProjectImportNetworkStateScript(),
        );
        if (finalSnapshot.projectTitle.trim()) {
          projectTitle = finalSnapshot.projectTitle.trim();
        }
        mergeProjectConversationSnapshot(collected, finalSnapshot);
        onProgress?.({
          collectedCount: collected.size,
          listItemCount: finalSnapshot.listItemCount,
          phase: 'collecting',
          projectTitle,
        });

        const didGrow =
          collected.size !== settleCollectedCount ||
          finalSnapshot.listItemCount !== settleListItemCount ||
          finalSnapshot.lastConversationUrl !== settleLastConversationUrl;
        const didChangeNetworkActivity =
          networkState.lastActivityAt !== lastSettledNetworkActivityAt;

        if (didGrow) {
          settleCollectedCount = collected.size;
          settleListItemCount = finalSnapshot.listItemCount;
          settleLastConversationUrl = finalSnapshot.lastConversationUrl;
          lastGrowthAt = Date.now();
          lastSettledNetworkActivityAt = networkState.lastActivityAt;
          continue;
        }

        if (didChangeNetworkActivity) {
          lastSettledNetworkActivityAt = networkState.lastActivityAt;
          lastGrowthAt = Date.now();
          continue;
        }

        if (
          networkState.inFlight === 0 &&
          Date.now() - Math.max(lastGrowthAt, networkState.lastResponseAt) >=
            PROJECT_LIST_SETTLE_IDLE_MS
        ) {
          break;
        }
      }

      return {
        canScrollMore: false,
        conversations: Array.from(collected.values()),
        lastConversationUrl: finalSnapshot?.lastConversationUrl ?? '',
        listItemCount: finalSnapshot?.listItemCount ?? collected.size,
        scrollHeight: finalSnapshot?.scrollHeight ?? 0,
        scrollTop: finalSnapshot?.scrollTop ?? 0,
        projectTitle,
      };
    } finally {
      await automationView.close();
    }
  }

  async collectProject(
    projectUrlValue: string,
    onProgress?: (progress: ProjectConversationImportProgress) => void,
  ): Promise<ProjectConversationCollectionResult> {
    const projectUrl = normalizeProjectUrl(projectUrlValue);
    const collectedProject = await this.collectProjectConversations(
      projectUrl,
      onProgress,
    );

    if (collectedProject.conversations.length === 0) {
      throw new Error('프로젝트에서 불러올 대화를 찾지 못했습니다.');
    }

    return {
      conversations: collectedProject.conversations,
      fetchedAt: new Date().toISOString(),
      projectTitle: collectedProject.projectTitle || '프로젝트',
      projectUrl,
    };
  }
}
