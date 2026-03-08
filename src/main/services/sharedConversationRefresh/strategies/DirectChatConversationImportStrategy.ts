import type {
  SharedConversationImport,
  SharedConversationRefreshRequest,
} from '../../../../shared/refresh/sharedConversationRefresh';
import { parseChatGptConversationHtmlSnapshot } from '../../../parsers/chatGptConversationHtmlParser';
import {
  buildChatGptConversationNetworkDiagnostics,
  parseChatGptConversationJsonPayload,
  parseChatGptConversationNetworkRecords,
} from '../../../parsers/chatGptConversationNetworkParser';
import { ChatGptAutomationView } from '../chatgpt/ChatGptAutomationView';
import {
  CHATGPT_CHALLENGE_TEXT_MARKERS,
  CHATGPT_LOGIN_TEXT_MARKERS,
  CHATGPT_LOGIN_URL_PATTERNS,
} from '../chatgpt/ChatGptDomSelectors';
import { waitForDirectConversationReady } from '../chatgpt/chatGptConversationLoadHelpers';
import { includesMarker } from '../chatgpt/chatGptRefreshHelpers';
import {
  buildExtractConversationHtmlSnapshotScript,
  buildFetchConversationJsonScript,
  buildPrepareConversationHtmlSnapshotScript,
  type ExtractedConversationHtmlSnapshot,
  type FetchedConversationJsonPayload,
} from '../chatgpt/chatGptConversationImportScripts';
import { SharedConversationRefreshError } from '../SharedConversationRefreshError';

const FALLBACK_TITLE_SUFFIX_PATTERN = /\s*[-|]\s*ChatGPT.*$/i;
const NETWORK_MONITOR_ATTACH_GRACE_MS = 1_500;
const BACKEND_HEADERS_CAPTURE_TIMEOUT_MS = 4_000;
const BACKEND_HEADERS_CAPTURE_POLL_MS = 120;

const normalizeTitle = (title: string, fallback: string) => {
  const normalizedTitle = title.replace(FALLBACK_TITLE_SUFFIX_PATTERN, '').trim();
  return normalizedTitle || fallback;
};

const extractConversationId = (value: string): string => {
  const match = value.match(/\/c\/([^/?#]+)/i);
  return match?.[1] ?? '';
};

const countMatches = (value: string, pattern: RegExp): number => {
  const matches = value.match(pattern);
  return matches ? matches.length : 0;
};

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

const buildConversationImportResult = (
  request: SharedConversationRefreshRequest,
  conversation: SharedConversationImport,
): SharedConversationImport => ({
  ...conversation,
  importOrigin: 'chat-url',
  refreshRequest: {
    chatUrl: request.chatUrl,
    conversationTitle:
      request.conversationTitle ??
      normalizeTitle(conversation.title, 'ChatGPT 대화'),
    mode: 'direct-chat-page',
    projectUrl: request.projectUrl,
    shareUrl: request.chatUrl,
  },
  title: normalizeTitle(
    request.conversationTitle || conversation.title,
    'ChatGPT 대화',
  ),
});

export class DirectChatConversationImportStrategy {
  async importFromChatUrl(
    request: SharedConversationRefreshRequest,
  ): Promise<SharedConversationImport> {
    if (!request.chatUrl) {
      throw new SharedConversationRefreshError(
        'chat_url_missing',
        '원본 ChatGPT 대화 URL이 없어 직접 가져오기를 수행할 수 없습니다.',
      );
    }

    const automationView = await ChatGptAutomationView.acquire(
      request.helperWindowMode ?? 'visible',
    );
    const conversationId = extractConversationId(request.chatUrl);

    try {
      let diagnosticsLabel = 'initial';
      const waitForMonitorAttachment = automationView
        .enableConversationNetworkMonitoring()
        .catch((): void => undefined);

      await automationView.load(request.chatUrl);
      const firstSnapshot = await automationView.getPageSnapshot();
      if (isLoginLikeSnapshot(firstSnapshot)) {
        await automationView.presentForAttention();
        throw new SharedConversationRefreshError(
          'login_required',
          'ChatGPT 로그인 또는 보안 확인이 필요합니다. 보조 창에서 먼저 마친 뒤 다시 시도해 주세요.',
          firstSnapshot.currentUrl || firstSnapshot.title,
        );
      }
      await Promise.race([
        waitForMonitorAttachment,
        new Promise<void>((resolve) => {
          setTimeout(resolve, NETWORK_MONITOR_ATTACH_GRACE_MS);
        }),
      ]);

      const waitForBackendReplayHeaders = async () => {
        const deadline = Date.now() + BACKEND_HEADERS_CAPTURE_TIMEOUT_MS;
        while (Date.now() < deadline && !automationView.isClosed()) {
          const headers = automationView.getLatestBackendApiHeaders()?.headers ?? {};
          if (Object.keys(headers).length > 0) {
            return true;
          }
          await sleep(BACKEND_HEADERS_CAPTURE_POLL_MS);
        }
        return false;
      };

      const tryFetchConversationJson = async (): Promise<SharedConversationImport | null> => {
        if (!conversationId) {
          return null;
        }

        const capturedBackendHeaders =
          automationView.getLatestBackendApiHeaders()?.headers ?? {};
        const fetchedConversationJson = await automationView.execute<FetchedConversationJsonPayload>(
          buildFetchConversationJsonScript(conversationId, capturedBackendHeaders),
        );

        console.info(
          `[gptviewer][direct-chat-import:backend-get-attempt] ${request.chatUrl}\nstatus=${fetchedConversationJson.status} ok=${fetchedConversationJson.ok} url=${fetchedConversationJson.url} body=${fetchedConversationJson.bodyText.length} replayHeaders=${Object.keys(
            capturedBackendHeaders,
          ).join(',') || '-'}`,
        );

        if (!fetchedConversationJson.ok) {
          return null;
        }

        try {
          const directConversation = parseChatGptConversationJsonPayload(
            JSON.parse(fetchedConversationJson.bodyText) as unknown,
            request.chatUrl,
          );

          if (!directConversation) {
            console.info(
              `[gptviewer][direct-chat-import:backend-get-null] ${request.chatUrl}\nbodyHasMapping=${fetchedConversationJson.bodyText.includes('"mapping"')} bodyHasCurrentNode=${fetchedConversationJson.bodyText.includes('"current_node"')} bodyHasMermaid=${/```mermaid\b/i.test(
                fetchedConversationJson.bodyText,
              )}`,
            );
            return null;
          }

          const messageText = directConversation.messages
            .map((message) => message.text)
            .join('\n\n');
          const fencedBlocks = countMatches(messageText, /```[\s\S]*?```/g);
          const mermaidBlocks = countMatches(messageText, /```mermaid\b/gi);

          console.info(
            `[gptviewer][direct-chat-import:backend-get] ${request.chatUrl}\nstatus=${fetchedConversationJson.status} url=${fetchedConversationJson.url} messages=${directConversation.messages.length} fenced=${fencedBlocks} mermaid=${mermaidBlocks}`,
          );

          return buildConversationImportResult(request, {
            fetchedAt: new Date().toISOString(),
            ...directConversation,
          });
        } catch {
          return null;
        }
      };

      await waitForBackendReplayHeaders();
      const directConversationFromBackend = await tryFetchConversationJson();
      if (directConversationFromBackend) {
        return directConversationFromBackend;
      }

      let isReady = await waitForDirectConversationReady(automationView, 12_000, 200);
      let networkRecords = automationView.getConversationNetworkRecords();
      let networkDiagnostics = buildChatGptConversationNetworkDiagnostics(
        networkRecords,
        request.chatUrl,
      );
      let networkConversation = parseChatGptConversationNetworkRecords(
        networkRecords,
        request.chatUrl,
      );

      if (!networkConversation) {
        diagnosticsLabel = 'reload-after-monitor-ready';
        await automationView.enableConversationNetworkMonitoring().catch((): void => undefined);
        await automationView.load(request.chatUrl);
        await waitForBackendReplayHeaders();
        const retriedDirectConversationFromBackend = await tryFetchConversationJson();
        if (retriedDirectConversationFromBackend) {
          return retriedDirectConversationFromBackend;
        }
        isReady = await waitForDirectConversationReady(automationView, 12_000, 200);
        networkRecords = automationView.getConversationNetworkRecords();
        networkDiagnostics = buildChatGptConversationNetworkDiagnostics(
          networkRecords,
          request.chatUrl,
        );
        networkConversation = parseChatGptConversationNetworkRecords(
          networkRecords,
          request.chatUrl,
        );
      }

      console.info(
        `[gptviewer][direct-chat-import:${diagnosticsLabel}] ${request.chatUrl}\n${networkDiagnostics}`,
      );

      if (networkConversation) {
        return buildConversationImportResult(request, {
          fetchedAt: new Date().toISOString(),
          ...networkConversation,
        });
      }

      await automationView.execute(buildPrepareConversationHtmlSnapshotScript());
      await waitForDirectConversationReady(automationView, 2_000, 120);

      const snapshot = await automationView.execute<ExtractedConversationHtmlSnapshot>(
        buildExtractConversationHtmlSnapshotScript(),
      );
      const parsedConversation = parseChatGptConversationHtmlSnapshot(
        snapshot,
        request.chatUrl,
      );

      if (!parsedConversation) {
        throw new SharedConversationRefreshError(
          'unknown',
          isReady
            ? '원본 ChatGPT 대화 HTML에서 메시지를 추출하지 못했습니다.'
            : '원본 ChatGPT 대화 DOM이 충분히 구성되지 않아 내용을 추출하지 못했습니다.',
          `${snapshot.currentUrl}\nblocks=${snapshot.blocks.length}\nhtmlLength=${snapshot.conversationHtml.length}\n${networkDiagnostics}`,
        );
      }

      return buildConversationImportResult(request, {
        fetchedAt: new Date().toISOString(),
        ...parsedConversation,
      });
    } finally {
      await automationView.close();
    }
  }
}
