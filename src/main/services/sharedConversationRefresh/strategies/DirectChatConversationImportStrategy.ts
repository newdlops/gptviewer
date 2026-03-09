import type {
  SharedConversationImport,
  SharedConversationImportWarning,
  SharedConversationRefreshRequest,
} from '../../../../shared/refresh/sharedConversationRefresh';
import { parseChatGptConversationHtmlSnapshot } from '../../../parsers/chatGptConversationHtmlParser';
import {
  buildChatGptConversationNetworkDiagnostics,
  parseChatGptConversationBodyText,
  parseChatGptConversationJsonPayload,
  parseChatGptConversationNetworkRecords,
} from '../../../parsers/chatGptConversationNetworkParser';
import { ChatGptAutomationView } from '../chatgpt/ChatGptAutomationView';
import {
  buildLoginRequiredDetail,
  ensureLoginAttentionIfNeeded,
  runWithLoginResume,
} from '../chatgpt/chatGptLoginState';
import { waitForDirectConversationReady } from '../chatgpt/chatGptConversationLoadHelpers';
import {
  buildExtractConversationHtmlSnapshotScript,
  buildFetchImageDataUrlFromUrlScript,
  buildExtractStandaloneHtmlSnapshotScript,
  buildFetchConversationAssetDataUrlScript,
  buildFetchConversationJsonScript,
  buildPrepareConversationHtmlSnapshotScript,
  type ExtractedConversationHtmlSnapshot,
  type ExtractedStandaloneHtmlSnapshot,
  type FetchedConversationAssetPayload,
  type FetchedConversationJsonPayload,
} from '../chatgpt/chatGptConversationImportScripts';
import { SharedConversationRefreshError } from '../SharedConversationRefreshError';
import type { ChatGptConversationNetworkRecord } from '../chatgpt/chatGptConversationNetworkMonitor';

const FALLBACK_TITLE_SUFFIX_PATTERN = /\s*[-|]\s*ChatGPT.*$/i;
const NETWORK_MONITOR_ATTACH_GRACE_MS = 1_500;
const BACKEND_HEADERS_CAPTURE_TIMEOUT_MS = 4_000;
const BACKEND_HEADERS_CAPTURE_POLL_MS = 120;
const LARGE_BACKEND_BODY_THRESHOLD = 180_000;
const EAGER_IMAGE_ASSET_RESOLVE_LIMIT = 0;
const WIDGET_STATE_MARKER = 'The latest state of the widget is:';
const SEDIMENT_FILE_ID_PATTERN = /sediment:\/\/(file_[a-z0-9_-]+)/gi;
const IMAGE_MARKDOWN_PATTERN = /!\[([^\]]*)\]\(([^)]+)\)/gi;
const RENDERABLE_IMAGE_URL_PATTERN =
  /^(data:image\/[a-z0-9.+-]+;base64,|https?:\/\/.+)/i;
const CHATGPT_ORIGIN = 'https://chatgpt.com';
const BACKEND_FILE_DOWNLOAD_URL_PATTERN =
  /\/backend-api\/files\/download\/([^/?#]+)/i;
const BACKEND_FILE_RESOURCE_URL_PATTERN =
  /\/backend-api\/files\/([^/?#]+)\/download/i;
const ABSOLUTE_OR_PROTOCOL_URL_PATTERN = /^https?:\/\/|^\/\//i;
const URL_LIKE_TEXT_PATTERN =
  /(https?:\/\/[^\s"'<>]+|\/\/[^\s"'<>]+|\/backend-api\/[^\s"'<>]+|https?:\\\/\\\/[^\s"'<>]+|\\\/backend-api\\\/[^\s"'<>]+)/gi;
const CHAT_IMPORT_SLOW_IMAGE_WARNING_MESSAGE =
  '이미지 자산이 포함된 대화라 불러오기와 렌더링에 시간이 걸릴 수 있습니다.';
const CHAT_IMPORT_SLOW_LARGE_BODY_WARNING_MESSAGE =
  '대화 원본 데이터가 큰 편이라 불러오기와 렌더링에 시간이 걸릴 수 있습니다.';
const CHAT_IMPORT_SLOW_IMAGE_AND_LARGE_BODY_WARNING_MESSAGE =
  '이미지 자산과 큰 대화 원본 데이터가 함께 있어 불러오기와 렌더링에 시간이 걸릴 수 있습니다.';

type ParsedConversationCandidate = NonNullable<
  ReturnType<typeof parseChatGptConversationBodyText>
>;
type ImageAssetResolutionStats = {
  dataUrlResolvedCount: number;
  networkResolvedCount: number;
  requestedCount: number;
  resolvedCount: number;
  unresolvedCount: number;
};

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

const scoreParsedConversation = (conversation: ParsedConversationCandidate): number =>
  conversation.messages.reduce((sum, message) => sum + message.text.length, 0);

const extractSedimentFileIds = (
  conversation: ParsedConversationCandidate,
): string[] => {
  const fileIds = new Set<string>();

  conversation.messages.forEach((message) => {
    let imageMatch = IMAGE_MARKDOWN_PATTERN.exec(message.text);
    while (imageMatch) {
      const fileId = extractFileIdFromAssetUrl(imageMatch[2] ?? '');
      if (fileId) {
        fileIds.add(fileId);
      }
      imageMatch = IMAGE_MARKDOWN_PATTERN.exec(message.text);
    }
    IMAGE_MARKDOWN_PATTERN.lastIndex = 0;

    let match = SEDIMENT_FILE_ID_PATTERN.exec(message.text);
    while (match) {
      if (match[1]) {
        fileIds.add(match[1]);
      }
      match = SEDIMENT_FILE_ID_PATTERN.exec(message.text);
    }
    SEDIMENT_FILE_ID_PATTERN.lastIndex = 0;
  });

  return [...fileIds];
};

const normalizeFileId = (value: string): string => {
  const normalizedValue = String(value || '')
    .trim()
    .replace(/^sediment:\/\//i, '')
    .replace(/%2[fF]/g, '/');
  if (!normalizedValue) {
    return '';
  }

  if (/^file_[a-z0-9_-]+$/i.test(normalizedValue)) {
    return normalizedValue.toLowerCase();
  }

  if (/^file-[a-z0-9_-]+$/i.test(normalizedValue)) {
    return `file_${normalizedValue.slice(5).toLowerCase()}`;
  }

  if (/^[a-z0-9_-]{16,}$/i.test(normalizedValue)) {
    return `file_${normalizedValue.toLowerCase()}`;
  }

  return '';
};

const normalizeAssetUrl = (value: string): string => {
  const normalizedValue = String(value || '')
    .trim()
    .replace(/\\\//g, '/')
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\u003[aA]/g, ':')
    .replace(/\\u003[fF]/g, '?')
    .replace(/\\u0026/g, '&');
  if (!normalizedValue) {
    return '';
  }

  if (normalizedValue.startsWith('//')) {
    return `https:${normalizedValue}`;
  }

  if (
    normalizedValue.startsWith('/backend-api/') ||
    normalizedValue.startsWith('/files/')
  ) {
    return new URL(normalizedValue, CHATGPT_ORIGIN).toString();
  }

  return normalizedValue;
};

const extractFileIdFromAssetUrl = (value: string): string => {
  const normalizedValue = normalizeAssetUrl(value);
  if (!normalizedValue) {
    return '';
  }

  const sedimentMatch = normalizedValue.match(/sediment:\/\/(file_[a-z0-9_-]+)/i);
  if (sedimentMatch?.[1]) {
    return normalizeFileId(sedimentMatch[1]);
  }

  const directMatch = normalizedValue.match(BACKEND_FILE_DOWNLOAD_URL_PATTERN);
  if (directMatch?.[1]) {
    return normalizeFileId(directMatch[1]);
  }

  const resourceMatch = normalizedValue.match(BACKEND_FILE_RESOURCE_URL_PATTERN);
  if (resourceMatch?.[1]) {
    return normalizeFileId(resourceMatch[1]);
  }

  return '';
};

const isLikelyRenderableImageUrl = (value: string): boolean => {
  const normalizedValue = normalizeAssetUrl(value);
  if (!normalizedValue || !ABSOLUTE_OR_PROTOCOL_URL_PATTERN.test(normalizedValue)) {
    return false;
  }

  return (
    /\.(png|jpe?g|gif|webp|avif|bmp|svg)(?:[?#].*)?$/i.test(normalizedValue) ||
    /(?:^|[/.])(oaiusercontent\.com|openaiusercontent\.com)/i.test(normalizedValue) ||
    /\/backend-api\/estuary\/content\b/i.test(normalizedValue) ||
    /[?&]id=file_[a-z0-9_-]+/i.test(normalizedValue) ||
    /response-content-type=image/i.test(normalizedValue) ||
    /[?&]mime_type=image%2F/i.test(normalizedValue)
  );
};

const tryParseJsonValue = (value: string): unknown | null => {
  const normalizedValue = String(value || '')
    .trim()
    .replace(/^\)\]\}',?\s*/u, '');
  if (!normalizedValue) {
    return null;
  }

  const candidates = [normalizedValue, normalizeAssetUrl(normalizedValue)];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // continue
    }
  }

  return null;
};

const tryParseJsonRecord = (value: string): Record<string, unknown> | null => {
  const parsed = tryParseJsonValue(value);
  try {
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const collectUrlStrings = (
  value: unknown,
  visited = new WeakSet<object>(),
): string[] => {
  if (typeof value === 'string') {
    const trimmedValue = normalizeAssetUrl(value);
    if (!trimmedValue) {
      return [];
    }
    const parsedJson = tryParseJsonValue(trimmedValue);
    if (parsedJson && typeof parsedJson === 'object') {
      return collectUrlStrings(parsedJson, visited);
    }
    if (ABSOLUTE_OR_PROTOCOL_URL_PATTERN.test(trimmedValue)) {
      return [trimmedValue];
    }
    return [...(trimmedValue.match(URL_LIKE_TEXT_PATTERN) ?? [])].map(
      (entry) => normalizeAssetUrl(entry),
    );
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectUrlStrings(entry, visited));
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  if (visited.has(value)) {
    return [];
  }
  visited.add(value);

  return Object.values(value as Record<string, unknown>).flatMap((entry) =>
    collectUrlStrings(entry, visited),
  );
};

const buildAssetUrlsFromNetworkRecords = (
  records: ChatGptConversationNetworkRecord[],
): Map<string, string> => {
  const assetUrlByFileId = new Map<string, string>();

  records.forEach((record) => {
    if (
      typeof record.url !== 'string' ||
      !record.url.includes('/backend-api/files/')
    ) {
      return;
    }

    const fileId = extractFileIdFromAssetUrl(record.url);
    if (!fileId || assetUrlByFileId.has(fileId)) {
      return;
    }

    const bodyText = String(record.bodyText || '').trim();
    const parsedBody = tryParseJsonRecord(bodyText);
    const bodyCandidates =
      parsedBody != null
        ? collectUrlStrings(parsedBody)
        : [...(normalizeAssetUrl(bodyText).match(URL_LIKE_TEXT_PATTERN) ?? [])];

    const resolvedUrl = bodyCandidates
      .map((candidate) => normalizeAssetUrl(candidate))
      .find((candidate) => isLikelyRenderableImageUrl(candidate));

    if (resolvedUrl) {
      assetUrlByFileId.set(fileId, resolvedUrl);
    }
  });

  return assetUrlByFileId;
};

const chooseConversationByImageResolution = (
  primaryConversation: ParsedConversationCandidate,
  fallbackConversation: ParsedConversationCandidate,
): ParsedConversationCandidate => {
  const countBlobImageUrls = (conversation: ParsedConversationCandidate) =>
    conversation.messages.reduce((count, message) => {
      const blobMatches = message.text.match(/!\[[^\]]*\]\(blob:[^)]+\)/gi);
      return count + (blobMatches?.length ?? 0);
    }, 0);
  const primaryBlobCount = countBlobImageUrls(primaryConversation);
  const fallbackBlobCount = countBlobImageUrls(fallbackConversation);
  if (primaryBlobCount !== fallbackBlobCount) {
    return primaryBlobCount < fallbackBlobCount
      ? primaryConversation
      : fallbackConversation;
  }

  const primaryUnresolved = extractSedimentFileIds(primaryConversation).length;
  const fallbackUnresolved = extractSedimentFileIds(fallbackConversation).length;
  if (primaryUnresolved !== fallbackUnresolved) {
    return primaryUnresolved < fallbackUnresolved
      ? primaryConversation
      : fallbackConversation;
  }

  return scoreParsedConversation(primaryConversation) >=
    scoreParsedConversation(fallbackConversation)
    ? primaryConversation
    : fallbackConversation;
};

const applyResolvedAssetDataUrls = (
  conversation: ParsedConversationCandidate,
  assetUrlByFileId: Map<string, string>,
): ParsedConversationCandidate => {
  if (assetUrlByFileId.size === 0) {
    return conversation;
  }

  return {
    ...conversation,
    messages: conversation.messages.map((message) => ({
      ...message,
      text: message.text.replace(IMAGE_MARKDOWN_PATTERN, (fullMatch, altText: string, url: string) => {
        const fileId = extractFileIdFromAssetUrl(url);
        if (!fileId) {
          return fullMatch;
        }

        const resolvedAssetUrl = assetUrlByFileId.get(fileId);
        if (!resolvedAssetUrl) {
          return fullMatch;
        }

        return `![${altText || 'image'}](${resolvedAssetUrl})`;
      }),
    })),
  };
};

const collectWidgetStateStrings = (
  value: unknown,
  results: string[],
  visited = new WeakSet<object>(),
  depth = 0,
): void => {
  if (depth > 12 || value == null) {
    return;
  }

  if (typeof value === 'string') {
    if (value.includes(WIDGET_STATE_MARKER)) {
      results.push(value);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) =>
      collectWidgetStateStrings(entry, results, visited, depth + 1),
    );
    return;
  }

  if (typeof value !== 'object') {
    return;
  }

  if (visited.has(value)) {
    return;
  }
  visited.add(value);

  Object.values(value as Record<string, unknown>).forEach((entry) =>
    collectWidgetStateStrings(entry, results, visited, depth + 1),
  );
};

const parseWidgetReportConversationFromBackendBody = (
  bodyText: string,
  fallbackUrl: string,
): ParsedConversationCandidate | null => {
  try {
    const parsedBody = JSON.parse(bodyText) as unknown;
    const widgetStateStrings: string[] = [];
    collectWidgetStateStrings(parsedBody, widgetStateStrings);

    const candidates = widgetStateStrings
      .map((widgetStateText) =>
        parseChatGptConversationBodyText(widgetStateText, fallbackUrl),
      )
      .filter(
        (candidate): candidate is ParsedConversationCandidate => !!candidate,
      );

    return (
      candidates.sort((left, right) => {
        const scoreDiff =
          scoreParsedConversation(right) - scoreParsedConversation(left);
        if (scoreDiff !== 0) {
          return scoreDiff;
        }

        return right.messages.length - left.messages.length;
      })[0] ?? null
    );
  } catch {
    return null;
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const resolveDeepResearchIframeBlocks = async (
  automationView: ChatGptAutomationView,
  snapshot: ExtractedConversationHtmlSnapshot,
): Promise<ExtractedConversationHtmlSnapshot> => {
  const resolvedBlocks = await Promise.all(
    snapshot.blocks.map(async (block) => {
      if (!block.deepResearchIframeSrc) {
        return block;
      }

      try {
        await automationView.load(block.deepResearchIframeSrc);
        const iframeSnapshot = await automationView.execute<ExtractedStandaloneHtmlSnapshot>(
          buildExtractStandaloneHtmlSnapshotScript(),
        );

        const mergedHtml = [block.html, iframeSnapshot.html].filter(Boolean).join('\n');
        return {
          ...block,
          html: mergedHtml,
        };
      } catch {
        return block;
      }
    }),
  );

  return {
    ...snapshot,
    blocks: resolvedBlocks,
  };
};

const buildConversationImportResult = (
  request: SharedConversationRefreshRequest,
  conversation: SharedConversationImport,
  importWarning?: SharedConversationImportWarning,
): SharedConversationImport => {
  const normalizedImportWarning = importWarning ?? conversation.importWarning;

  return {
    ...conversation,
    ...(normalizedImportWarning ? { importWarning: normalizedImportWarning } : {}),
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
  };
};

const buildChatImportSlowWarning = (
  hasImageAssets: boolean,
  hasLargeBackendBody: boolean,
): SharedConversationImportWarning | undefined => {
  if (!hasImageAssets && !hasLargeBackendBody) {
    return undefined;
  }

  const message = hasImageAssets && hasLargeBackendBody
    ? CHAT_IMPORT_SLOW_IMAGE_AND_LARGE_BODY_WARNING_MESSAGE
    : hasImageAssets
      ? CHAT_IMPORT_SLOW_IMAGE_WARNING_MESSAGE
      : CHAT_IMPORT_SLOW_LARGE_BODY_WARNING_MESSAGE;

  return {
    code: 'chat-import-may-be-slow',
    message,
  };
};

export class DirectChatConversationImportStrategy {
  private async resolveSedimentImageAssets(
    automationView: ChatGptAutomationView,
    conversation: ParsedConversationCandidate,
    replayHeaders: Record<string, string>,
    conversationId: string,
    onAssetResolution?: (stats: ImageAssetResolutionStats) => void,
  ): Promise<ParsedConversationCandidate> {
    const fileIds = extractSedimentFileIds(conversation);
    if (fileIds.length === 0) {
      onAssetResolution?.({
        dataUrlResolvedCount: 0,
        networkResolvedCount: 0,
        requestedCount: 0,
        resolvedCount: 0,
        unresolvedCount: 0,
      });
      return conversation;
    }

    if (fileIds.length > EAGER_IMAGE_ASSET_RESOLVE_LIMIT) {
      onAssetResolution?.({
        dataUrlResolvedCount: 0,
        networkResolvedCount: 0,
        requestedCount: fileIds.length,
        resolvedCount: 0,
        unresolvedCount: fileIds.length,
      });
      console.info(
        `[gptviewer][direct-chat-import:image-assets-deferred] requested=${fileIds.length} limit=${EAGER_IMAGE_ASSET_RESOLVE_LIMIT}`,
      );
      return conversation;
    }

    const resolveStartedAt = Date.now();
    console.info(
      `[gptviewer][direct-chat-import:image-assets-start] fileIds=${fileIds.length} conversationId=${conversationId || '-'}`,
    );
    const assetUrlByFileId = new Map<string, string>();
    let processedCount = 0;
    for (const fileId of fileIds) {
      try {
        const assetPayload = await automationView.execute<FetchedConversationAssetPayload>(
          buildFetchConversationAssetDataUrlScript(
            fileId,
            replayHeaders,
            conversationId,
          ),
        );

        const resolvedAssetUrl = assetPayload?.dataUrl ?? assetPayload?.url ?? '';
        if (
          assetPayload?.ok &&
          typeof resolvedAssetUrl === 'string' &&
          RENDERABLE_IMAGE_URL_PATTERN.test(resolvedAssetUrl)
        ) {
          assetUrlByFileId.set(fileId, resolvedAssetUrl);
        }
      } catch {
        // Keep unresolved pointers when asset fetch fails.
      }
      processedCount += 1;
      if (
        processedCount === 1 ||
        processedCount === fileIds.length ||
        processedCount % 5 === 0
      ) {
        console.info(
          `[gptviewer][direct-chat-import:image-assets-progress] processed=${processedCount}/${fileIds.length} resolved=${assetUrlByFileId.size} elapsedMs=${Date.now() - resolveStartedAt}`,
        );
      }
    }

    const networkAssetUrlByFileId = buildAssetUrlsFromNetworkRecords(
      automationView.getConversationNetworkRecords(),
    );
    networkAssetUrlByFileId.forEach((assetUrl, fileId) => {
      if (!assetUrlByFileId.has(fileId)) {
        assetUrlByFileId.set(fileId, assetUrl);
      }
    });

    for (const [fileId, assetUrl] of [...assetUrlByFileId.entries()]) {
      if (!assetUrl || assetUrl.startsWith('data:image/')) {
        continue;
      }

      try {
        const payload = await automationView.execute<FetchedConversationAssetPayload>(
          buildFetchImageDataUrlFromUrlScript(assetUrl, replayHeaders),
        );
        if (payload?.ok && payload.dataUrl?.startsWith('data:image/')) {
          assetUrlByFileId.set(fileId, payload.dataUrl);
        }
      } catch {
        // Keep resolved URL as-is when data URL conversion fails.
      }
    }

    const unresolvedFileIds = fileIds.filter((fileId) => !assetUrlByFileId.has(fileId));
    const dataUrlResolvedCount = [...assetUrlByFileId.values()].filter((assetUrl) =>
      assetUrl.startsWith('data:image/'),
    ).length;
    const summary: ImageAssetResolutionStats = {
      dataUrlResolvedCount,
      networkResolvedCount: networkAssetUrlByFileId.size,
      requestedCount: fileIds.length,
      resolvedCount: assetUrlByFileId.size,
      unresolvedCount: Math.max(0, fileIds.length - assetUrlByFileId.size),
    };
    onAssetResolution?.(summary);
    const unresolvedSample =
      unresolvedFileIds.length > 0
        ? unresolvedFileIds.slice(0, 6).join(',')
        : '-';
    if (networkAssetUrlByFileId.size === 0 && unresolvedFileIds.length > 0) {
      const downloadBodySamples = automationView
        .getConversationNetworkRecords()
        .filter((record) => /\/backend-api\/files\/download\//i.test(record.url))
        .slice(-4)
        .map((record) => {
          const preview = String(record.bodyText || '')
            .replace(/\s+/g, ' ')
            .slice(0, 220);
          return `${record.status}:${record.url} bodyPreview=${preview}`;
        });
      if (downloadBodySamples.length > 0) {
        console.info(
          `[gptviewer][direct-chat-import:image-assets:download-json-sample] ${downloadBodySamples.join(
            ' | ',
          )}`,
        );
      }
    }

    console.info(
      `[gptviewer][direct-chat-import:image-assets] requested=${summary.requestedCount} resolved=${summary.resolvedCount} unresolved=${summary.unresolvedCount} dataUrlResolved=${summary.dataUrlResolvedCount} networkResolved=${summary.networkResolvedCount} unresolvedSample=${unresolvedSample} elapsedMs=${Date.now() - resolveStartedAt}`,
    );

    return applyResolvedAssetDataUrls(conversation, assetUrlByFileId);
  }

  async importFromChatUrl(
    request: SharedConversationRefreshRequest,
  ): Promise<SharedConversationImport> {
    if (!request.chatUrl) {
      throw new SharedConversationRefreshError(
        'chat_url_missing',
        '원본 ChatGPT 대화 URL이 없어 직접 가져오기를 수행할 수 없습니다.',
      );
    }

    return runWithLoginResume({
      initialMode: request.helperWindowMode ?? 'visible',
      runAttempt: async (automationView) =>
        this.importFromChatUrlWithView(request, automationView),
    });
  }

  private async importFromChatUrlWithView(
    request: SharedConversationRefreshRequest,
    automationView: ChatGptAutomationView,
  ): Promise<SharedConversationImport> {
    const conversationId = extractConversationId(request.chatUrl ?? '');
    let hasImageAssetContent = false;
    let hasLargeBackendBody = false;
    let unresolvedImageFallbackConversation: ParsedConversationCandidate | null = null;
    let unresolvedImageFallbackSource: 'backend' | 'network' | null = null;
    const markImageAssetResolution = (stats: ImageAssetResolutionStats) => {
      if (stats.requestedCount > 0) {
        hasImageAssetContent = true;
      }
    };
    const resolveImportWarning = () =>
      buildChatImportSlowWarning(hasImageAssetContent, hasLargeBackendBody);
    const rememberUnresolvedImageFallback = (
      candidateConversation: ParsedConversationCandidate,
      source: 'backend' | 'network',
    ) => {
      if (!unresolvedImageFallbackConversation) {
        unresolvedImageFallbackConversation = candidateConversation;
        unresolvedImageFallbackSource = source;
        return;
      }

      const chosenConversation = chooseConversationByImageResolution(
        unresolvedImageFallbackConversation,
        candidateConversation,
      );
      const keepCurrent = chosenConversation === unresolvedImageFallbackConversation;
      unresolvedImageFallbackConversation = chosenConversation;
      unresolvedImageFallbackSource = keepCurrent
        ? unresolvedImageFallbackSource
        : source;
    };

    let diagnosticsLabel = 'initial';
    const waitForMonitorAttachment = automationView
      .enableConversationNetworkMonitoring()
      .catch((): void => undefined);

    await automationView.load(request.chatUrl);
    const loginSnapshot = await ensureLoginAttentionIfNeeded(automationView);
    if (loginSnapshot) {
      throw new SharedConversationRefreshError(
        'login_required',
        'ChatGPT 로그인 또는 보안 확인이 필요합니다. 보조 창에서 먼저 마친 뒤 다시 시도해 주세요.',
        buildLoginRequiredDetail(loginSnapshot),
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

        if (fetchedConversationJson.status === 401) {
          const loginSnapshot = await ensureLoginAttentionIfNeeded(automationView);
          if (!loginSnapshot) {
            await automationView.presentForAttention();
          }
          throw new SharedConversationRefreshError(
            'login_required',
            'ChatGPT 로그인 또는 보안 확인이 필요합니다. 보조 창에서 먼저 마친 뒤 다시 시도해 주세요.',
            loginSnapshot
              ? buildLoginRequiredDetail(loginSnapshot)
              : `backend-api conversation GET returned 401 for ${request.chatUrl}`,
          );
        }

        if (!fetchedConversationJson.ok) {
          return null;
        }
        if (fetchedConversationJson.bodyText.length >= LARGE_BACKEND_BODY_THRESHOLD) {
          hasLargeBackendBody = true;
          console.info(
            `[gptviewer][direct-chat-import:large-body] ${request.chatUrl}\nbody=${fetchedConversationJson.bodyText.length} threshold=${LARGE_BACKEND_BODY_THRESHOLD}`,
          );
        }

        const bodyHasWidgetMarker = fetchedConversationJson.bodyText.includes(
          WIDGET_STATE_MARKER,
        );
        const bodyHasWidgetState =
          fetchedConversationJson.bodyText.includes('"widget_state"') ||
          fetchedConversationJson.bodyText.includes('"venus_widget_state"');
        const bodyHasReportMessage = fetchedConversationJson.bodyText.includes(
          '"report_message"',
        );

        let widgetConversation: ParsedConversationCandidate | null = null;

        if (bodyHasWidgetMarker || bodyHasWidgetState || bodyHasReportMessage) {
          console.info(
            `[gptviewer][direct-chat-import:backend-widget-parse-attempt] ${request.chatUrl}\nbody=${fetchedConversationJson.bodyText.length} marker=${bodyHasWidgetMarker} widgetState=${bodyHasWidgetState} reportMessage=${bodyHasReportMessage}`,
          );

          widgetConversation = parseWidgetReportConversationFromBackendBody(
            fetchedConversationJson.bodyText,
            request.chatUrl,
          );

          if (widgetConversation) {
            const widgetPreview =
              widgetConversation.messages
                .find((message) => message.role === 'assistant')
                ?.text.slice(0, 120)
                .replace(/\s+/g, ' ') ?? '';

            console.info(
              `[gptviewer][direct-chat-import:backend-widget-parse-success] ${request.chatUrl}\nmessages=${widgetConversation.messages.length} chars=${scoreParsedConversation(
                widgetConversation,
              )} preview=${widgetPreview}`,
            );
          }

          if (!widgetConversation) {
            console.info(
              `[gptviewer][direct-chat-import:backend-widget-parse-null] ${request.chatUrl}\nbody=${fetchedConversationJson.bodyText.length} marker=${bodyHasWidgetMarker} widgetState=${bodyHasWidgetState} reportMessage=${bodyHasReportMessage}`,
            );
          }
        }

        try {
          const parseStartedAt = Date.now();
          let directConversationCandidate: ParsedConversationCandidate | null = null;
          let directParseMode: 'json' | 'body-text' | 'none' = 'none';
          try {
            const parsedPayload = JSON.parse(
              fetchedConversationJson.bodyText,
            ) as unknown;
            directConversationCandidate = parseChatGptConversationJsonPayload(
              parsedPayload,
              request.chatUrl,
            );
            if (directConversationCandidate) {
              directParseMode = 'json';
            }
          } catch {
            // Fall through to body text parser.
          }

          if (!directConversationCandidate) {
            directConversationCandidate = parseChatGptConversationBodyText(
              fetchedConversationJson.bodyText,
              request.chatUrl,
            );
            if (directConversationCandidate) {
              directParseMode = 'body-text';
            }
          }
          console.info(
            `[gptviewer][direct-chat-import:backend-parse] ${request.chatUrl}\nmode=${directParseMode} elapsedMs=${Date.now() - parseStartedAt} messages=${directConversationCandidate?.messages.length ?? 0}`,
          );
          const directConversation = directConversationCandidate
            ? await this.resolveSedimentImageAssets(
                automationView,
                directConversationCandidate,
                capturedBackendHeaders,
                conversationId,
                markImageAssetResolution,
              )
            : null;

          if (!directConversation) {
            if (widgetConversation) {
              console.info(
                `[gptviewer][direct-chat-import:backend-widget-fallback] ${request.chatUrl}\nmessages=${widgetConversation.messages.length} chars=${scoreParsedConversation(
                  widgetConversation,
                )}`,
              );

              return buildConversationImportResult(request, {
                fetchedAt: new Date().toISOString(),
                ...widgetConversation,
              }, resolveImportWarning());
            }

            console.info(
              `[gptviewer][direct-chat-import:backend-get-null] ${request.chatUrl}\nbodyHasMapping=${fetchedConversationJson.bodyText.includes('"mapping"')} bodyHasCurrentNode=${fetchedConversationJson.bodyText.includes('"current_node"')} bodyHasWidgetMarker=${fetchedConversationJson.bodyText.includes(
                WIDGET_STATE_MARKER,
              )} bodyHasWidgetState=${fetchedConversationJson.bodyText.includes(
                '"widget_state"',
              )} bodyHasReportMessage=${fetchedConversationJson.bodyText.includes(
                '"report_message"',
              )} bodyHasMermaid=${/```mermaid\b/i.test(
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
          const unresolvedSedimentFileIds = extractSedimentFileIds(directConversation);

          console.info(
            `[gptviewer][direct-chat-import:backend-get] ${request.chatUrl}\nstatus=${fetchedConversationJson.status} url=${fetchedConversationJson.url} messages=${directConversation.messages.length} fenced=${fencedBlocks} mermaid=${mermaidBlocks}`,
          );

          if (unresolvedSedimentFileIds.length > 0) {
            const unresolvedSample = unresolvedSedimentFileIds
              .slice(0, 6)
              .join(',');
            console.info(
              `[gptviewer][direct-chat-import:backend-get-unresolved-images] ${request.chatUrl}\nunresolved=${unresolvedSedimentFileIds.length} sample=${unresolvedSample}`,
            );
            if (
              unresolvedSedimentFileIds.length > EAGER_IMAGE_ASSET_RESOLVE_LIMIT
            ) {
              console.info(
                `[gptviewer][direct-chat-import:backend-get-deferred-images] ${request.chatUrl}\nunresolved=${unresolvedSedimentFileIds.length} limit=${EAGER_IMAGE_ASSET_RESOLVE_LIMIT}`,
              );
              return buildConversationImportResult(request, {
                fetchedAt: new Date().toISOString(),
                ...directConversation,
              }, resolveImportWarning());
            }
            rememberUnresolvedImageFallback(directConversation, 'backend');
            return null;
          }

          return buildConversationImportResult(request, {
            fetchedAt: new Date().toISOString(),
            ...directConversation,
          }, resolveImportWarning());
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
        networkConversation = await this.resolveSedimentImageAssets(
          automationView,
          networkConversation,
          automationView.getLatestBackendApiHeaders()?.headers ?? {},
          conversationId,
          markImageAssetResolution,
        );
        const unresolvedSedimentFileIds = extractSedimentFileIds(networkConversation);
        if (unresolvedSedimentFileIds.length === 0) {
          return buildConversationImportResult(request, {
            fetchedAt: new Date().toISOString(),
            ...networkConversation,
          }, resolveImportWarning());
        }

        const unresolvedSample = unresolvedSedimentFileIds
          .slice(0, 6)
          .join(',');
        console.info(
          `[gptviewer][direct-chat-import:network-unresolved-images] ${request.chatUrl}\nunresolved=${unresolvedSedimentFileIds.length} sample=${unresolvedSample}`,
        );
        if (unresolvedSedimentFileIds.length > EAGER_IMAGE_ASSET_RESOLVE_LIMIT) {
          console.info(
            `[gptviewer][direct-chat-import:network-deferred-images] ${request.chatUrl}\nunresolved=${unresolvedSedimentFileIds.length} limit=${EAGER_IMAGE_ASSET_RESOLVE_LIMIT}`,
          );
          return buildConversationImportResult(request, {
            fetchedAt: new Date().toISOString(),
            ...networkConversation,
          }, resolveImportWarning());
        }
        rememberUnresolvedImageFallback(networkConversation, 'network');
      }

      await automationView.execute(buildPrepareConversationHtmlSnapshotScript());
      await waitForDirectConversationReady(automationView, 2_000, 120);

      const snapshot = await automationView.execute<ExtractedConversationHtmlSnapshot>(
        buildExtractConversationHtmlSnapshotScript(),
      );
      const resolvedSnapshot = await resolveDeepResearchIframeBlocks(
        automationView,
        snapshot,
      );
      const parsedConversation = parseChatGptConversationHtmlSnapshot(
        resolvedSnapshot,
        request.chatUrl,
      );

      if (!parsedConversation) {
        if (unresolvedImageFallbackConversation) {
          console.info(
            `[gptviewer][direct-chat-import:html-parse-fallback] ${request.chatUrl}\nsource=${unresolvedImageFallbackSource ?? '-'} unresolved=${extractSedimentFileIds(
              unresolvedImageFallbackConversation,
            ).length}`,
          );
          return buildConversationImportResult(request, {
            fetchedAt: new Date().toISOString(),
            ...unresolvedImageFallbackConversation,
          }, resolveImportWarning());
        }

        throw new SharedConversationRefreshError(
          'unknown',
          isReady
            ? '원본 ChatGPT 대화 HTML에서 메시지를 추출하지 못했습니다.'
            : '원본 ChatGPT 대화 DOM이 충분히 구성되지 않아 내용을 추출하지 못했습니다.',
          `${resolvedSnapshot.currentUrl}\nblocks=${resolvedSnapshot.blocks.length}\nhtmlLength=${resolvedSnapshot.conversationHtml.length}\n${networkDiagnostics}`,
        );
      }

      const resolvedParsedConversation = await this.resolveSedimentImageAssets(
        automationView,
        parsedConversation,
        automationView.getLatestBackendApiHeaders()?.headers ?? {},
        conversationId,
        markImageAssetResolution,
      );
      const unresolvedHtmlSedimentFileIds = extractSedimentFileIds(
        resolvedParsedConversation,
      );
      if (!unresolvedImageFallbackConversation) {
        return buildConversationImportResult(request, {
          fetchedAt: new Date().toISOString(),
          ...resolvedParsedConversation,
        }, resolveImportWarning());
      }

      const chosenConversation = chooseConversationByImageResolution(
        resolvedParsedConversation,
        unresolvedImageFallbackConversation,
      );
      const chooseLabel =
        chosenConversation === resolvedParsedConversation
          ? 'html'
          : unresolvedImageFallbackSource ?? 'fallback';
      console.info(
        `[gptviewer][direct-chat-import:final-image-source] ${request.chatUrl}\nchoose=${chooseLabel} htmlUnresolved=${unresolvedHtmlSedimentFileIds.length} fallbackUnresolved=${extractSedimentFileIds(
          unresolvedImageFallbackConversation,
        ).length}`,
      );

      return buildConversationImportResult(request, {
        fetchedAt: new Date().toISOString(),
        ...chosenConversation,
      }, resolveImportWarning());
  }
}
