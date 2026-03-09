import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import type {
  ProjectConversationCollectionResult,
  ProjectConversationImportProgress,
  ProjectConversationImportRequest,
} from '../shared/import/projectConversationImport';
import type {
  SharedConversationImport,
  SharedConversationImportWarning,
  SharedConversationMessage,
  SharedConversationRefreshRequest,
  SharedConversationSource,
} from '../shared/refresh/sharedConversationRefresh';
import { encodeSharedConversationRefreshError } from '../shared/refresh/sharedConversationRefreshErrorCodec';
import { registerGoogleDriveSyncIpc } from './ipc/googleDrive';
import {
  buildSourcePreviewFromHtml,
  buildSourcePreviewFromSnapshot,
  cleanSourceText,
  getHostnameFallback,
  type SourcePreviewSnapshot,
} from './parsers/sourcePreviewParser';
import {
  parseChatGptConversationHtmlSnapshot,
  parseChatGptStandaloneHtml,
} from './parsers/chatGptConversationHtmlParser';
import {
  buildChatGptConversationNetworkDiagnostics,
  parseChatGptConversationNetworkRecords,
} from './parsers/chatGptConversationNetworkParser';
import { ProjectConversationImportService } from './services/projectConversationImport/ProjectConversationImportService';
import { ChatGptAutomationView } from './services/sharedConversationRefresh/chatgpt/ChatGptAutomationView';
import { ChatGptConversationNetworkMonitor } from './services/sharedConversationRefresh/chatgpt/chatGptConversationNetworkMonitor';
import {
  buildActivateDeepResearchEmbedsScript,
  buildExtractConversationHtmlSnapshotScript,
  buildExtractStandaloneHtmlSnapshotScript,
  buildFetchConversationAssetDataUrlScript,
  buildFetchImageDataUrlFromUrlScript,
  type ExtractedConversationHtmlSnapshot,
  type ExtractedStandaloneHtmlSnapshot,
  type FetchedConversationAssetPayload,
} from './services/sharedConversationRefresh/chatgpt/chatGptConversationImportScripts';
import { SharedConversationRefreshService } from './services/sharedConversationRefresh/SharedConversationRefreshService';
import { SharedConversationRefreshError } from './services/sharedConversationRefresh/SharedConversationRefreshError';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

type SourceIconImport = {
  contentType?: string;
  dataUrl: string;
  finalUrl: string;
};

type ChatGptImageAssetImport = {
  cacheKey: string;
  dataUrl: string;
  sourceUrl: string;
};

type ChatGptImageResolveTask = {
  cacheKey: string;
  normalizedAssetUrl: string;
  normalizedChatUrl: string;
  resolve: (value: ChatGptImageAssetImport | null) => void;
};

type FrameStandaloneSnapshot = ExtractedStandaloneHtmlSnapshot & {
  frameOrigin: string;
  frameUrl: string;
};

const CHATGPT_IMAGE_ASSET_CACHE_MAX = 512;
const CHATGPT_IMAGE_RESOLVE_TASK_TIMEOUT_MS = 40_000;
const CHATGPT_IMAGE_RESOLVE_TIMEOUT_MARKER = Symbol('chatgpt-image-timeout');
const CHATGPT_FILE_ID_PATTERN =
  /(?:sediment:\/\/)?(file_[a-z0-9_-]+)|\/backend-api\/files\/download\/(file_[a-z0-9_-]+)|\/backend-api\/files\/(file_[a-z0-9_-]+)\/download|[?&]id=(file_[a-z0-9_-]+)/i;
const CHATGPT_CONVERSATION_ID_PATTERN = /\/c\/([^/?#]+)/i;
const chatGptImageAssetCache = new Map<string, ChatGptImageAssetImport>();
const chatGptImageAssetInFlight = new Map<
  string,
  Promise<ChatGptImageAssetImport | null>
>();
const chatGptImageResolveQueue: ChatGptImageResolveTask[] = [];
let chatGptImageResolveWorkerBusy = false;
let chatGptImageResolveWorkerView: ChatGptAutomationView | null = null;
let chatGptImageResolveWorkerChatUrl = '';
let chatGptImageResolveWorkerHeaders: Record<string, string> = {};

const isMeaningfulDeepResearchUrl = (value: string | null | undefined): boolean => {
  const normalizedValue = (value || '').trim();
  return (
    !!normalizedValue &&
    normalizedValue !== 'about:blank' &&
    normalizedValue.startsWith('http') &&
    normalizedValue.includes('connector_openai_deep_research')
  );
};

const showPreviewWindowInBackground = (window: BrowserWindow) => {
  const display = screen.getDisplayMatching(
    window.getBounds(),
  ) || screen.getPrimaryDisplay();
  const { workArea } = display;
  const { width, height } = window.getBounds();
  const visibleEdge = 8;
  const x = workArea.x + workArea.width - visibleEdge;
  const y = workArea.y + workArea.height - visibleEdge;

  window.setBounds({
    x,
    y,
    width,
    height,
  });
  window.setOpacity(0.01);
  window.setVisibleOnAllWorkspaces(false, {
    visibleOnFullScreen: false,
  });
  window.showInactive();
};

const extractBestStandaloneSnapshotFromSubframes = async (
  previewWindow: BrowserWindow,
): Promise<FrameStandaloneSnapshot | null> => {
  const frames = previewWindow.webContents.mainFrame.framesInSubtree.filter(
    (frame) => frame !== previewWindow.webContents.mainFrame && !frame.isDestroyed(),
  );

  let bestSnapshot: FrameStandaloneSnapshot | null = null;

  for (const frame of frames) {
    let snapshot: ExtractedStandaloneHtmlSnapshot | null = null;

    try {
      snapshot = (await frame.executeJavaScript(
        buildExtractStandaloneHtmlSnapshotScript(),
        true,
      )) as ExtractedStandaloneHtmlSnapshot;
    } catch {
      continue;
    }

    if (!snapshot || typeof snapshot.html !== 'string' || !snapshot.html.trim()) {
      continue;
    }

    const typedSnapshot: FrameStandaloneSnapshot = {
      ...snapshot,
      frameOrigin: frame.origin || '',
      frameUrl: frame.url || snapshot.currentUrl || '',
    };

    const typedSnapshotLooksLikeDeepResearchFrame =
      isMeaningfulDeepResearchUrl(typedSnapshot.frameUrl) ||
      isMeaningfulDeepResearchUrl(typedSnapshot.currentUrl) ||
      typedSnapshot.frameOrigin.includes('oaiusercontent.com');
    const bestSnapshotLooksLikeDeepResearchFrame =
      bestSnapshot &&
      (isMeaningfulDeepResearchUrl(bestSnapshot.frameUrl) ||
        isMeaningfulDeepResearchUrl(bestSnapshot.currentUrl) ||
        bestSnapshot.frameOrigin.includes('oaiusercontent.com'));

    if (
      !bestSnapshot ||
      (!bestSnapshotLooksLikeDeepResearchFrame &&
        !!typedSnapshotLooksLikeDeepResearchFrame) ||
      typedSnapshot.html.length > bestSnapshot.html.length
    ) {
      bestSnapshot = typedSnapshot;
    }
  }

  return bestSnapshot;
};

const SOURCE_PREVIEW_EXTRACTION_SCRIPT = `
(() => {
  const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
  const unique = (values) => [...new Set(values)];
  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) {
      return true;
    }

    const style = window.getComputedStyle(element);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      !element.hasAttribute('hidden') &&
      element.getAttribute('aria-hidden') !== 'true'
    );
  };
  const collectTexts = (selectors, limit) =>
    unique(
      Array.from(document.querySelectorAll(selectors))
        .filter((element) => isVisible(element))
        .map((element) => clean(element.textContent))
        .filter((value) => value.length > 0),
    ).slice(0, limit);
  const getMeta = (selectors) => {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const content = element?.getAttribute('content');
      if (content && clean(content)) {
        return clean(content);
      }
    }
    return undefined;
  };
  const isIcoLikeIcon = (href, type) => {
    const normalizedHref = (href || '').toLowerCase();
    const normalizedType = (type || '').toLowerCase();

    return (
      normalizedType.includes('icon') ||
      normalizedType.includes('ico') ||
      normalizedHref.endsWith('.ico') ||
      normalizedHref.includes('.ico?')
    );
  };
  const scoreIconElement = (element) => {
    const href = clean(element?.getAttribute('href'));
    const rel = clean(element?.getAttribute('rel')).toLowerCase();
    const type = clean(element?.getAttribute('type')).toLowerCase();
    const sizes = clean(element?.getAttribute('sizes')).toLowerCase();

    if (!href || !rel.includes('icon')) {
      return -1;
    }

    let score = 0;

    if (rel.includes('apple-touch-icon')) {
      score += 120;
    }

    if (href.endsWith('.svg') || type.includes('svg')) {
      score += 110;
    }

    if (href.endsWith('.png') || type.includes('png')) {
      score += 100;
    }

    if (
      href.endsWith('.webp') ||
      type.includes('webp') ||
      href.endsWith('.jpg') ||
      href.endsWith('.jpeg') ||
      type.includes('jpeg')
    ) {
      score += 80;
    }

    if (rel.includes('icon')) {
      score += 30;
    }

    if (sizes.includes('180x180')) {
      score += 25;
    } else if (sizes.includes('96x96') || sizes.includes('64x64')) {
      score += 20;
    } else if (sizes.includes('48x48') || sizes.includes('32x32')) {
      score += 15;
    } else if (sizes.includes('16x16')) {
      score += 10;
    }

    if (isIcoLikeIcon(href, type)) {
      score -= 100;
    }

    return score;
  };
  const iconElement = Array.from(document.querySelectorAll('link[rel]'))
    .filter((element) => clean(element.getAttribute('rel')).toLowerCase().includes('icon'))
    .sort((left, right) => scoreIconElement(right) - scoreIconElement(left))[0];
  const iconHref = iconElement?.getAttribute('href');

  return {
    description: getMeta([
      'meta[property="og:description"]',
      'meta[name="description"]',
      'meta[name="twitter:description"]',
    ]),
    headings: collectTexts('main h1, article h1, h1, main h2, article h2, h2, main h3, article h3, h3', 24),
    iconHref: iconHref ? clean(iconHref) : undefined,
    iconUrl: iconHref ? new URL(iconHref, window.location.href).toString() : undefined,
    paragraphs: collectTexts('main p, article p, p, main li, article li, blockquote', 48),
    publisher: getMeta([
      'meta[property="og:site_name"]',
      'meta[name="application-name"]',
    ]),
    title: getMeta([
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
    ]) || clean(document.title),
    url: window.location.href,
  };
})()
`;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

const decodeRscPayload = (value: string): string => JSON.parse(`"${value}"`);

const CITATION_TOKEN_PATTERN = /\uE200(?:cite|filecite|navlist)\uE202[\s\S]*?\uE201/g;
const INLINE_CITATION_TOKEN_PATTERN =
  /\uE200(filecite|cite|navlist)\uE202([^\uE202\uE201]+)(?:\uE202([^\uE201]+))?\uE201/g;

const buildSourceTitle = (url: string, candidates: Array<unknown>): string => {
  const resolvedTitle = candidates.find(
    (candidate): candidate is string =>
      typeof candidate === 'string' && cleanSourceText(candidate).length > 0,
  );

  if (resolvedTitle) {
    return cleanSourceText(resolvedTitle);
  }

  return getHostnameFallback(url);
};

const normalizeSourceUrl = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  try {
    const parsedUrl = new URL(value.trim());
    return ['http:', 'https:'].includes(parsedUrl.protocol)
      ? parsedUrl.toString()
      : null;
  } catch {
    return null;
  }
};

const pickFirstMeaningfulText = (
  candidates: Array<unknown>,
  fallback?: string,
): string | undefined => {
  const resolvedText = candidates.find(
    (candidate): candidate is string =>
      typeof candidate === 'string' && candidate.trim().length > 0,
  );

  if (!resolvedText) {
    return fallback;
  }

  return cleanSourceText(resolvedText) || fallback;
};

const escapeMarkdownLinkLabel = (value: string): string =>
  value.replace(/[[\]\\]/g, '\\$&').trim();

const getCitationSourceIndex = (referenceId: string): number | null => {
  const match = referenceId.match(
    /(?:search|news|finance|sports|weather)(\d+)$/i,
  );

  if (!match) {
    return null;
  }

  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 0 ? index : null;
};

const buildInlineCitationMarkdown = (
  citationType: string,
  referenceId: string,
  detail: string | undefined,
  sources: SharedConversationSource[],
): string => {
  if (citationType === 'filecite') {
    const normalizedDetail =
      typeof detail === 'string' && detail.trim() ? detail.trim() : '';
    const attachmentTarget = normalizedDetail
      ? `attachment://${referenceId}#${encodeURIComponent(normalizedDetail)}`
      : `attachment://${referenceId}`;

    return `[파일 참조](${attachmentTarget})`;
  }

  if (citationType === 'cite') {
    const sourceIndex = getCitationSourceIndex(referenceId);
    const source = sourceIndex !== null ? sources[sourceIndex] : undefined;

    if (!source?.url) {
      return '';
    }

    const title = escapeMarkdownLinkLabel(
      cleanSourceText(source.title) || getHostnameFallback(source.url),
    );

    return title ? `[${title}](${source.url})` : '';
  }

  return '';
};

const inferImageMimeType = (url: string): string => {
  const normalizedUrl = url.toLowerCase();

  if (normalizedUrl.endsWith('.svg') || normalizedUrl.includes('.svg?')) {
    return 'image/svg+xml';
  }

  if (normalizedUrl.endsWith('.png') || normalizedUrl.includes('.png?')) {
    return 'image/png';
  }

  if (
    normalizedUrl.endsWith('.jpg') ||
    normalizedUrl.endsWith('.jpeg') ||
    normalizedUrl.includes('.jpg?') ||
    normalizedUrl.includes('.jpeg?')
  ) {
    return 'image/jpeg';
  }

  if (normalizedUrl.endsWith('.webp') || normalizedUrl.includes('.webp?')) {
    return 'image/webp';
  }

  if (normalizedUrl.endsWith('.gif') || normalizedUrl.includes('.gif?')) {
    return 'image/gif';
  }

  return 'image/x-icon';
};

const extractChatGptConversationId = (value: string): string => {
  const match = value.match(CHATGPT_CONVERSATION_ID_PATTERN);
  return match?.[1] ?? '';
};

const extractChatGptImageFileId = (value: string): string => {
  const match = value.match(CHATGPT_FILE_ID_PATTERN);
  const fileId =
    match?.[1] || match?.[2] || match?.[3] || match?.[4] || '';
  return fileId ? fileId.toLowerCase() : '';
};

const normalizeChatGptConversationUrl = (value: string): string | null => {
  try {
    const parsedUrl = new URL((value || '').trim());
    if (
      !['https:', 'http:'].includes(parsedUrl.protocol) ||
      !['chatgpt.com', 'www.chatgpt.com', 'chat.openai.com'].includes(
        parsedUrl.hostname,
      )
    ) {
      return null;
    }

    if (!CHATGPT_CONVERSATION_ID_PATTERN.test(parsedUrl.pathname)) {
      return null;
    }

    parsedUrl.hash = '';
    return parsedUrl.toString();
  } catch {
    return null;
  }
};

const buildChatGptImageAssetCacheKey = (
  conversationUrl: string,
  assetUrl: string,
): string => {
  const fileId = extractChatGptImageFileId(assetUrl);
  return `${conversationUrl}::${fileId || assetUrl.trim()}`;
};

const rememberChatGptImageAssetCache = (entry: ChatGptImageAssetImport) => {
  if (chatGptImageAssetCache.has(entry.cacheKey)) {
    chatGptImageAssetCache.delete(entry.cacheKey);
  }
  chatGptImageAssetCache.set(entry.cacheKey, entry);

  while (chatGptImageAssetCache.size > CHATGPT_IMAGE_ASSET_CACHE_MAX) {
    const oldestKey = chatGptImageAssetCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    chatGptImageAssetCache.delete(oldestKey);
  }
};

const waitForBackendReplayHeaders = async (
  automationView: ChatGptAutomationView,
  timeoutMs = 4_000,
  intervalMs = 120,
) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !automationView.isClosed()) {
    const headers = automationView.getLatestBackendApiHeaders()?.headers ?? {};
    if (Object.keys(headers).length > 0) {
      return headers;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }

  return automationView.getLatestBackendApiHeaders()?.headers ?? {};
};

const clearChatGptImageResolveWorkerContext = () => {
  chatGptImageResolveWorkerChatUrl = '';
  chatGptImageResolveWorkerHeaders = {};
};

const closeChatGptImageResolveWorkerView = async () => {
  if (chatGptImageResolveWorkerView) {
    await chatGptImageResolveWorkerView.close().catch((): void => undefined);
    chatGptImageResolveWorkerView = null;
  }
  clearChatGptImageResolveWorkerContext();
};

const ensureChatGptImageResolveWorkerView = async (): Promise<ChatGptAutomationView> => {
  if (
    chatGptImageResolveWorkerView &&
    !chatGptImageResolveWorkerView.isClosed()
  ) {
    return chatGptImageResolveWorkerView;
  }

  chatGptImageResolveWorkerView = await ChatGptAutomationView.acquire('background');
  clearChatGptImageResolveWorkerContext();
  return chatGptImageResolveWorkerView;
};

const resolveChatGptImageAssetWithWorker = async (
  automationView: ChatGptAutomationView,
  normalizedChatUrl: string,
  normalizedAssetUrl: string,
  cacheKey: string,
): Promise<ChatGptImageAssetImport | null> => {
  const extractedFileId = extractChatGptImageFileId(normalizedAssetUrl);
  const conversationId = extractChatGptConversationId(normalizedChatUrl);
  const startedAt = Date.now();
  console.info(
    `[gptviewer][chatgpt-image:resolve-start] key=${cacheKey} fileId=${extractedFileId || '-'} conversationId=${conversationId || '-'}`,
  );

  const bootstrapUrl = (() => {
    try {
      const parsedUrl = new URL(normalizedChatUrl);
      return `${parsedUrl.origin}/`;
    } catch {
      return 'https://chatgpt.com/';
    }
  })();

  if (
    chatGptImageResolveWorkerChatUrl !== bootstrapUrl ||
    Object.keys(chatGptImageResolveWorkerHeaders).length === 0
  ) {
    const bootstrapStartedAt = Date.now();
    await automationView.enableConversationNetworkMonitoring().catch((): void => undefined);
    await automationView.load(bootstrapUrl);
    chatGptImageResolveWorkerChatUrl = bootstrapUrl;
    chatGptImageResolveWorkerHeaders = await waitForBackendReplayHeaders(
      automationView,
      1_500,
      100,
    );
    console.info(
      `[gptviewer][chatgpt-image:worker-bootstrap] url=${bootstrapUrl} headers=${Object.keys(
        chatGptImageResolveWorkerHeaders,
      ).length} elapsedMs=${Date.now() - bootstrapStartedAt}`,
    );
  }

  const replayHeaders = chatGptImageResolveWorkerHeaders;
  let resolvedDataUrl = '';

  if (extractedFileId) {
    const payload = await automationView.execute<FetchedConversationAssetPayload>(
      buildFetchConversationAssetDataUrlScript(
        extractedFileId,
        replayHeaders,
        conversationId,
      ),
    );
    if (payload?.ok) {
      resolvedDataUrl =
        typeof payload.dataUrl === 'string' ? payload.dataUrl : '';

      if (
        !resolvedDataUrl &&
        typeof payload.url === 'string' &&
        /^https?:\/\//i.test(payload.url)
      ) {
        const converted = await automationView.execute<FetchedConversationAssetPayload>(
          buildFetchImageDataUrlFromUrlScript(payload.url, replayHeaders),
        );
        if (
          converted?.ok &&
          typeof converted.dataUrl === 'string' &&
          converted.dataUrl.startsWith('data:image/')
        ) {
          resolvedDataUrl = converted.dataUrl;
        }
      }
    }
  } else if (/^https?:\/\//i.test(normalizedAssetUrl)) {
    const converted = await automationView.execute<FetchedConversationAssetPayload>(
      buildFetchImageDataUrlFromUrlScript(normalizedAssetUrl, replayHeaders),
    );
    if (
      converted?.ok &&
      typeof converted.dataUrl === 'string' &&
      converted.dataUrl.startsWith('data:image/')
    ) {
      resolvedDataUrl = converted.dataUrl;
    }
  }

  if (!resolvedDataUrl.startsWith('data:image/')) {
    console.info(
      `[gptviewer][chatgpt-image:resolve-miss] key=${cacheKey} elapsedMs=${Date.now() - startedAt}`,
    );
    return null;
  }

  const result: ChatGptImageAssetImport = {
    cacheKey,
    dataUrl: resolvedDataUrl,
    sourceUrl: normalizedChatUrl,
  };
  rememberChatGptImageAssetCache(result);
  console.info(
    `[gptviewer][chatgpt-image:resolve-success] key=${cacheKey} elapsedMs=${Date.now() - startedAt}`,
  );
  return result;
};

const runChatGptImageResolveWorker = async () => {
  if (chatGptImageResolveWorkerBusy) {
    return;
  }
  chatGptImageResolveWorkerBusy = true;
  console.info(
    `[gptviewer][chatgpt-image:worker-start] queueSize=${chatGptImageResolveQueue.length}`,
  );

  try {
    while (chatGptImageResolveQueue.length > 0) {
      const task = chatGptImageResolveQueue.shift();
      if (!task) {
        continue;
      }
      console.info(
        `[gptviewer][chatgpt-image:worker-dequeue] key=${task.cacheKey} remaining=${chatGptImageResolveQueue.length}`,
      );

      let resolvedValue: ChatGptImageAssetImport | null = null;
      let taskStatus: 'error' | 'miss' | 'success' | 'timeout' = 'miss';
      const taskStartedAt = Date.now();
      try {
        const resolvePromise = (async () => {
          const workerView = await ensureChatGptImageResolveWorkerView();
          return resolveChatGptImageAssetWithWorker(
            workerView,
            task.normalizedChatUrl,
            task.normalizedAssetUrl,
            task.cacheKey,
          );
        })();
        const racedResult = await new Promise<
          ChatGptImageAssetImport | null | typeof CHATGPT_IMAGE_RESOLVE_TIMEOUT_MARKER
        >((resolve, reject) => {
          const timeoutId = setTimeout(
            () => resolve(CHATGPT_IMAGE_RESOLVE_TIMEOUT_MARKER),
            CHATGPT_IMAGE_RESOLVE_TASK_TIMEOUT_MS,
          );
          resolvePromise
            .then((value) => {
              clearTimeout(timeoutId);
              resolve(value);
            })
            .catch((error: unknown) => {
              clearTimeout(timeoutId);
              reject(error);
            });
        });

        if (racedResult === CHATGPT_IMAGE_RESOLVE_TIMEOUT_MARKER) {
          taskStatus = 'timeout';
          resolvedValue = null;
          console.warn(
            `[gptviewer][chatgpt-image:worker-timeout] key=${task.cacheKey} timeoutMs=${CHATGPT_IMAGE_RESOLVE_TASK_TIMEOUT_MS}`,
          );
          await closeChatGptImageResolveWorkerView();
        } else {
          resolvedValue = racedResult;
          taskStatus = resolvedValue ? 'success' : 'miss';
        }
      } catch (error) {
        taskStatus = 'error';
        resolvedValue = null;
        const errorMessage = error instanceof Error ? error.message : 'unknown';
        console.warn(
          `[gptviewer][chatgpt-image:worker-error] key=${task.cacheKey} error=${errorMessage}`,
        );
        await closeChatGptImageResolveWorkerView();
      }

      chatGptImageAssetInFlight.delete(task.cacheKey);
      task.resolve(resolvedValue);
      console.info(
        `[gptviewer][chatgpt-image:worker-task-done] key=${task.cacheKey} status=${taskStatus} elapsedMs=${Date.now() - taskStartedAt}`,
      );
    }
  } finally {
    chatGptImageResolveWorkerBusy = false;

    if (chatGptImageResolveQueue.length === 0 && chatGptImageResolveWorkerView) {
      console.info('[gptviewer][chatgpt-image:worker-idle-close]');
      await closeChatGptImageResolveWorkerView();
    } else if (chatGptImageResolveQueue.length > 0) {
      void runChatGptImageResolveWorker();
    }
  }
};

const enqueueChatGptImageResolveTask = (
  cacheKey: string,
  normalizedChatUrl: string,
  normalizedAssetUrl: string,
): Promise<ChatGptImageAssetImport | null> =>
  new Promise((resolve) => {
    chatGptImageResolveQueue.push({
      cacheKey,
      normalizedAssetUrl,
      normalizedChatUrl,
      resolve,
    });
    console.info(
      `[gptviewer][chatgpt-image:queue] key=${cacheKey} size=${chatGptImageResolveQueue.length}`,
    );
    void runChatGptImageResolveWorker();
  });

const toSourceIconImport = async (
  response: Response,
  fallbackUrl: string,
): Promise<SourceIconImport> => {
  const finalUrl = response.url || fallbackUrl;
  const contentTypeHeader = response.headers.get('content-type') || '';
  const contentType = contentTypeHeader.split(';')[0]?.trim() || inferImageMimeType(finalUrl);
  const bytes = Buffer.from(await response.arrayBuffer());

  return {
    contentType,
    dataUrl: `data:${contentType};base64,${bytes.toString('base64')}`,
    finalUrl,
  };
};

const shouldReplaceTitle = (currentTitle: string, nextTitle: string, url: string): boolean => {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return currentTitle === hostname && nextTitle !== hostname;
  } catch {
    return nextTitle.length > currentTitle.length;
  }
};

const mergeSourceMetadata = (
  currentSource: SharedConversationSource | undefined,
  nextSource: SharedConversationSource,
): SharedConversationSource => {
  if (!currentSource) {
    return nextSource;
  }

  return {
    attribution:
      currentSource.attribution && currentSource.attribution.length >= (nextSource.attribution?.length ?? 0)
        ? currentSource.attribution
        : nextSource.attribution,
    description:
      currentSource.description && currentSource.description.length >= (nextSource.description?.length ?? 0)
        ? currentSource.description
        : nextSource.description,
    iconUrl: currentSource.iconUrl || nextSource.iconUrl,
    publisher:
      currentSource.publisher && currentSource.publisher.length >= (nextSource.publisher?.length ?? 0)
        ? currentSource.publisher
        : nextSource.publisher,
    title: shouldReplaceTitle(currentSource.title, nextSource.title, currentSource.url)
      ? nextSource.title
      : currentSource.title,
    url: currentSource.url,
  };
};

const extractMessageSources = (
  metadata: Record<string, unknown>,
): SharedConversationSource[] => {
  const dedupedSources = new Map<string, SharedConversationSource>();
  const visitedObjects = new WeakSet<object>();

  const addSource = (
    urlValue: unknown,
    candidates: Array<unknown>,
    descriptionCandidates: Array<unknown>,
    publisherCandidates: Array<unknown>,
    attributionValue?: unknown,
  ) => {
    const url = normalizeSourceUrl(urlValue);
    if (!url) {
      return;
    }

    const attribution =
      typeof attributionValue === 'string' && attributionValue.trim()
        ? attributionValue.trim()
        : undefined;

    const nextSource: SharedConversationSource = {
      attribution,
      description: pickFirstMeaningfulText(descriptionCandidates),
      publisher: pickFirstMeaningfulText(publisherCandidates, attribution),
      title: buildSourceTitle(url, candidates),
      url,
    };

    dedupedSources.set(
      url,
      mergeSourceMetadata(dedupedSources.get(url), nextSource),
    );
  };

  const visit = (value: unknown, parent?: Record<string, unknown>) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, parent));
      return;
    }

    if (!value || typeof value !== 'object') {
      return;
    }

    if (visitedObjects.has(value)) {
      return;
    }
    visitedObjects.add(value);

    const record = value as Record<string, unknown>;
    const parentTitleCandidates = parent
      ? [
          parent.title,
          parent.alt,
          parent.attribution,
          parent.matched_text,
          parent.prompt_text,
        ]
      : [];

    addSource(
      record.url,
      [
        record.title,
        record.alt,
        record.attribution,
        record.matched_text,
        record.prompt_text,
        ...parentTitleCandidates,
      ],
      [
        record.snippet,
        record.description,
        record.summary,
        record.text,
        record.prompt_text,
        record.matched_text,
        record.alt,
        parent?.snippet,
        parent?.description,
        parent?.summary,
        parent?.text,
        parent?.prompt_text,
        parent?.matched_text,
        parent?.alt,
      ],
      [
        record.attribution,
        record.publisher,
        parent?.attribution,
        parent?.publisher,
      ],
      record.attribution,
    );

    if (Array.isArray(record.safe_urls)) {
      record.safe_urls.forEach((urlValue) => {
        addSource(
          urlValue,
          [
            record.title,
            record.alt,
            record.attribution,
            record.matched_text,
            record.prompt_text,
            ...parentTitleCandidates,
          ],
          [
            record.snippet,
            record.description,
            record.summary,
            record.text,
            record.prompt_text,
            record.matched_text,
            record.alt,
            parent?.snippet,
            parent?.description,
            parent?.summary,
            parent?.text,
            parent?.prompt_text,
            parent?.matched_text,
            parent?.alt,
          ],
          [
            record.attribution,
            record.publisher,
            parent?.attribution,
            parent?.publisher,
          ],
          record.attribution,
        );
      });
    }

    if (Array.isArray(record.items)) {
      visit(record.items, record);
    }
    if (Array.isArray(record.supporting_websites)) {
      visit(record.supporting_websites, record);
    }
    if (Array.isArray(record.refs)) {
      visit(record.refs, record);
    }
  };

  visit(metadata.content_references);
  visit(metadata.citations);

  return [...dedupedSources.values()];
};

const normalizeMessageText = (
  value: string,
  sources: SharedConversationSource[],
): string => {
  const normalizedCitations = value
    .replace(
      INLINE_CITATION_TOKEN_PATTERN,
      (_match, citationType: string, referenceId: string, detail?: string) => {
        const markdown = buildInlineCitationMarkdown(
          citationType,
          referenceId,
          detail,
          sources,
        );

        return markdown ? ` ${markdown} ` : ' ';
      },
    )
    .replace(CITATION_TOKEN_PATTERN, '')
    .replace(/\r/g, '');

  return normalizedCitations
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
    .map((segment) => {
      if (/^(```|~~~)/.test(segment)) {
        return segment.replace(/\u00a0/g, ' ');
      }

      return segment
        .replace(/\u00a0/g, ' ')
        .replace(/\t/g, ' ')
        .replace(/[ \f\v]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n');
    })
    .join('')
    .trim();
};

const sanitizeConversationTitle = (title: string): string =>
  title
    .replace(/^ChatGPT\s*-\s*/i, '')
    .replace(/\s*[|-]\s*ChatGPT$/i, '')
    .replace(/\s+[|·-]\s+OpenAI$/i, '')
    .trim() || '공유 대화';

const extractLargestRscPayload = (html: string): string | null => {
  const matches = [
    ...html.matchAll(/streamController\.enqueue\("([\s\S]*?)"\);<\/script>/g),
  ];

  if (matches.length === 0) {
    return null;
  }

  return (
    matches.sort((left, right) => right[1].length - left[1].length)[0]?.[1] ??
    null
  );
};

const extractDeepResearchIframeSrcFromHtml = (
  html: string,
  fallbackUrl: string,
): string | null => {
  const iframeMatch =
    html.match(
      /<iframe\b[^>]*(?:title="internal:\/\/deep-research"|src="([^"]*connector_openai_deep_research[^"]*)")[^>]*src="([^"]+)"[^>]*>/i,
    ) ??
    html.match(
      /<iframe\b[^>]*src="([^"]*connector_openai_deep_research[^"]*)"[^>]*(?:title="internal:\/\/deep-research")?[^>]*>/i,
    );

  const rawSrc =
    iframeMatch?.[2] ??
    iframeMatch?.[1] ??
    '';

  if (!rawSrc) {
    return null;
  }

  try {
    return new URL(rawSrc, fallbackUrl).toString();
  } catch {
    return null;
  }
};

const SHARED_DEEP_RESEARCH_WARNING_MESSAGE =
  '이 대화는 공유 URL에서 불러왔으며, 신버전 Deep Research 본문 일부를 가져오지 못했을 수 있습니다. 가능하면 원본 ChatGPT 대화 링크로 다시 불러오세요.';

const extractSharedConversationFromHtml = (
  html: string,
  fallbackUrl: string,
): Omit<SharedConversationImport, 'fetchedAt'> | null => {
  const rawPayload = extractLargestRscPayload(html);
  if (!rawPayload) {
    return null;
  }

  const decodedPayload = decodeRscPayload(rawPayload);
  const payload = JSON.parse(decodedPayload) as unknown[];

  const mappingKeyIndex = payload.indexOf('mapping');
  const currentNodeKeyIndex = payload.indexOf('current_node');
  const titleKeyIndex = payload.indexOf('title');

  const rootObject = payload.find(
    (entry) =>
      !!entry &&
      typeof entry === 'object' &&
      !Array.isArray(entry) &&
      mappingKeyIndex >= 0 &&
      currentNodeKeyIndex >= 0 &&
      titleKeyIndex >= 0 &&
      `_${mappingKeyIndex}` in (entry as Record<string, unknown>) &&
      `_${currentNodeKeyIndex}` in (entry as Record<string, unknown>) &&
      `_${titleKeyIndex}` in (entry as Record<string, unknown>),
  ) as Record<string, unknown> | undefined;

  if (!rootObject) {
    return null;
  }

  const resolvedIndexCache = new Map<number, unknown>();

  const resolveValue = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((item) => resolveReference(item));
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    const record = value as Record<string, unknown>;
    const resolvedRecord: Record<string, unknown> = {};

    Object.entries(record).forEach(([key, entryValue]) => {
      if (key.startsWith('_') && /^_\d+$/.test(key)) {
        const resolvedKey = payload[Number(key.slice(1))];
        if (typeof resolvedKey === 'string') {
          resolvedRecord[resolvedKey] = resolveReference(entryValue);
        }
      } else {
        resolvedRecord[key] = resolveValue(entryValue);
      }
    });

    return resolvedRecord;
  };

  const resolveReference = (value: unknown): unknown => {
    if (typeof value === 'number' && Number.isInteger(value)) {
      if (value < 0) {
        return null;
      }

      if (resolvedIndexCache.has(value)) {
        return resolvedIndexCache.get(value);
      }

      const resolved = resolveValue(payload[value]);
      resolvedIndexCache.set(value, resolved);
      return resolved;
    }

    return resolveValue(value);
  };

  const conversation = resolveValue(rootObject) as {
    current_node?: string;
    mapping?: Record<
      string,
      {
        message?: {
          author?: { role?: string };
          content?: { parts?: string[] };
          metadata?: Record<string, unknown>;
        };
        parent?: string | null;
      }
    >;
    title?: string;
  };

  if (!conversation.mapping || !conversation.current_node) {
    return null;
  }

  const orderedNodes: Array<(typeof conversation.mapping)[string]> = [];
  const visitedNodeIds = new Set<string>();
  let currentNodeId: string | null = conversation.current_node;

  while (
    currentNodeId &&
    !visitedNodeIds.has(currentNodeId) &&
    conversation.mapping[currentNodeId]
  ) {
    visitedNodeIds.add(currentNodeId);
    orderedNodes.push(conversation.mapping[currentNodeId]);
    currentNodeId = conversation.mapping[currentNodeId].parent ?? null;
  }

  orderedNodes.reverse();

  const messages = orderedNodes
    .map((node) => {
      const message = node.message;
      const role = message?.author?.role;
      const metadata = message?.metadata ?? {};
      const sources = extractMessageSources(metadata);
      const parts = Array.isArray(message?.content?.parts)
        ? message.content.parts
        : [];
      const text = normalizeMessageText(parts.join('\n\n'), sources);

      if (
        (role !== 'assistant' && role !== 'user') ||
        !text ||
        metadata.is_visually_hidden_from_conversation === true ||
        metadata.is_redacted === true
      ) {
        return null;
      }

      return {
        role,
        sources,
        text,
      };
    })
    .filter(
      (message): message is SharedConversationMessage =>
        !!message,
    );

  if (messages.length === 0) {
    return null;
  }

  return {
    messages,
    sourceUrl: fallbackUrl,
    summary: messages[0].text.replace(/\n/g, ' ').slice(0, 80),
    title: sanitizeConversationTitle(conversation.title ?? '공유 대화'),
  };
};

const mergeDeepResearchMessages = (
  baseConversation: Omit<SharedConversationImport, 'fetchedAt'> | null,
  iframeConversation: Omit<SharedConversationImport, 'fetchedAt' | 'refreshRequest'> | null,
  fallbackUrl: string,
): Omit<SharedConversationImport, 'fetchedAt'> | null => {
  if (!baseConversation && !iframeConversation) {
    return null;
  }

  if (!baseConversation && iframeConversation) {
    return {
      ...iframeConversation,
      sourceUrl: fallbackUrl,
      title: sanitizeConversationTitle(iframeConversation.title ?? '공유 대화'),
    };
  }

  if (!baseConversation || !iframeConversation || iframeConversation.messages.length === 0) {
    return baseConversation;
  }

  const iframeMessages = iframeConversation.messages.filter(
    (message) => !!message.text.trim(),
  );
  if (iframeMessages.length === 0) {
    return baseConversation;
  }

  const lastAssistantIndex = [...baseConversation.messages]
    .map((message, index) => ({ index, message }))
    .reverse()
    .find(({ message }) => message.role === 'assistant')?.index;

  const iframeJoinedText = iframeMessages.map((message) => message.text.trim()).join('\n\n').trim();

  if (!iframeJoinedText) {
    return baseConversation;
  }

  if (
    baseConversation.messages.some(
      (message) => message.role === 'assistant' && message.text.trim() === iframeJoinedText,
    )
  ) {
    return baseConversation;
  }

  const shouldReplaceLastAssistant =
    lastAssistantIndex !== undefined &&
    (() => {
      const lastAssistantText =
        baseConversation.messages[lastAssistantIndex]?.text?.trim() ?? '';
      if (!lastAssistantText) {
        return true;
      }

      if (/심층\s*리서치|deep\s*research/i.test(lastAssistantText)) {
        return true;
      }

      return lastAssistantText.length < Math.max(300, Math.floor(iframeJoinedText.length * 0.35));
    })();

  const mergedMessages = [...baseConversation.messages];
  if (shouldReplaceLastAssistant && lastAssistantIndex !== undefined) {
    mergedMessages.splice(lastAssistantIndex, 1, ...iframeMessages);
  } else {
    mergedMessages.push(...iframeMessages);
  }

  const summarySource =
    mergedMessages.find((message) => message.role === 'assistant')?.text ??
    mergedMessages[0]?.text ??
    '';

  return {
    ...baseConversation,
    messages: mergedMessages,
    sourceUrl: fallbackUrl,
    summary: summarySource.replace(/\n/g, ' ').slice(0, 80),
    title: sanitizeConversationTitle(
      baseConversation.title || iframeConversation.title || '공유 대화',
    ),
  };
};

const getConversationTextStats = (
  conversation: Omit<SharedConversationImport, 'fetchedAt' | 'refreshRequest'> | null,
) => {
  if (!conversation) {
    return {
      assistantChars: 0,
      messageCount: 0,
      totalChars: 0,
    };
  }

  let assistantChars = 0;
  let totalChars = 0;

  conversation.messages.forEach((message) => {
    const textLength = message.text.trim().length;
    totalChars += textLength;
    if (message.role === 'assistant') {
      assistantChars += textLength;
    }
  });

  return {
    assistantChars,
    messageCount: conversation.messages.length,
    totalChars,
  };
};

const shouldPreferRenderedSharedConversationBase = (
  staticConversation: Omit<SharedConversationImport, 'fetchedAt' | 'refreshRequest'> | null,
  renderedConversation: Omit<SharedConversationImport, 'fetchedAt' | 'refreshRequest'> | null,
  staticDeepResearchIframeSrc: string | null,
): boolean => {
  if (!renderedConversation) {
    return false;
  }

  if (!staticConversation || !staticDeepResearchIframeSrc) {
    return true;
  }

  const staticStats = getConversationTextStats(staticConversation);
  const renderedStats = getConversationTextStats(renderedConversation);

  if (renderedStats.assistantChars > staticStats.assistantChars * 1.1) {
    return true;
  }

  if (
    renderedStats.messageCount >= Math.max(1, staticStats.messageCount - 8) &&
    renderedStats.totalChars > staticStats.totalChars * 1.05
  ) {
    return true;
  }

  return false;
};

const mergeRenderedSharedConversationBase = (
  staticConversation: Omit<SharedConversationImport, 'fetchedAt' | 'refreshRequest'> | null,
  renderedConversation: Omit<SharedConversationImport, 'fetchedAt' | 'refreshRequest'> | null,
): Omit<SharedConversationImport, 'fetchedAt' | 'refreshRequest'> | null => {
  if (!staticConversation) {
    return renderedConversation;
  }

  if (!renderedConversation) {
    return staticConversation;
  }

  const mergedMessages = [...staticConversation.messages];
  let staticCursor = 0;
  let replacements = 0;

  const normalizeForCompare = (value: string) =>
    value.replace(/\s+/g, ' ').trim();

  for (const renderedMessage of renderedConversation.messages) {
    const renderedText = renderedMessage.text.trim();
    if (!renderedText) {
      continue;
    }

    let matchedIndex = -1;
    for (let index = staticCursor; index < mergedMessages.length; index += 1) {
      if (mergedMessages[index].role === renderedMessage.role) {
        matchedIndex = index;
        break;
      }
    }

    if (matchedIndex === -1) {
      break;
    }

    const staticMessage = mergedMessages[matchedIndex];
    const staticText = staticMessage.text.trim();
    const normalizedStaticText = normalizeForCompare(staticText);
    const normalizedRenderedText = normalizeForCompare(renderedText);

    const shouldReplace =
      renderedMessage.role === 'assistant' &&
      normalizedRenderedText.length > normalizedStaticText.length * 1.08 &&
      (
        !normalizedStaticText ||
        normalizedRenderedText.includes(normalizedStaticText.slice(0, 120)) ||
        normalizedStaticText.includes(normalizedRenderedText.slice(0, 120)) ||
        normalizedRenderedText.length - normalizedStaticText.length > 800
      );

    if (shouldReplace) {
      mergedMessages[matchedIndex] = {
        ...staticMessage,
        sources:
          renderedMessage.sources.length > 0
            ? renderedMessage.sources
            : staticMessage.sources,
        text: renderedMessage.text,
      };
      replacements += 1;
    }

    staticCursor = matchedIndex + 1;
  }

  console.info(
    `[gptviewer][shared-deep-research:rendered-share-merge-base] static=${staticConversation.messages.length} rendered=${renderedConversation.messages.length} replacements=${replacements}`,
  );

  if (replacements === 0) {
    return staticConversation;
  }

  const summarySource =
    mergedMessages.find((message) => message.role === 'assistant')?.text ??
    mergedMessages[0]?.text ??
    '';

  return {
    ...staticConversation,
    messages: mergedMessages,
    summary: summarySource.replace(/\n/g, ' ').slice(0, 80),
    title: sanitizeConversationTitle(
      staticConversation.title || renderedConversation.title || '공유 대화',
    ),
  };
};

const loadRenderedStandaloneConversation = async (
  iframeUrl: string,
): Promise<Omit<SharedConversationImport, 'fetchedAt' | 'refreshRequest'> | null> => {
  const previewWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  previewWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const networkMonitor = new ChatGptConversationNetworkMonitor(
    previewWindow.webContents,
  );

  try {
    showPreviewWindowInBackground(previewWindow);
    const networkMonitorReadyPromise = networkMonitor
      .ready()
      .catch((): void => undefined);
    await previewWindow.loadURL(iframeUrl, {
      httpReferrer: iframeUrl,
    });
    console.info(
      `[gptviewer][shared-deep-research:rendered-load] iframeUrl=${iframeUrl}`,
    );
    await Promise.race([
      networkMonitorReadyPromise,
      new Promise((resolve) => setTimeout(resolve, 1_500)),
    ]);

    const deadline = Date.now() + 12_000;
    let bestSnapshot: ExtractedStandaloneHtmlSnapshot | null = null;

    while (Date.now() < deadline && !previewWindow.isDestroyed()) {
      try {
        await previewWindow.webContents.executeJavaScript(
          buildActivateDeepResearchEmbedsScript(),
          true,
        );
      } catch {
        // Ignore activation failures and continue probing.
      }

      const snapshot = await previewWindow.webContents.executeJavaScript(
        buildExtractStandaloneHtmlSnapshotScript(),
        true,
      );

      if (
        snapshot &&
        typeof snapshot === 'object' &&
        'html' in snapshot &&
        typeof snapshot.html === 'string' &&
        snapshot.html.length > (bestSnapshot?.html.length ?? 0)
      ) {
        bestSnapshot = snapshot as ExtractedStandaloneHtmlSnapshot;
        console.info(
          `[gptviewer][shared-deep-research:rendered-snapshot] currentUrl=${
            bestSnapshot.currentUrl || iframeUrl
          } html=${bestSnapshot.html.length} iframeCount=${
            bestSnapshot.iframeCount ?? 0
          } allIframeCount=${bestSnapshot.allIframeCount ?? 0} depth=${
            bestSnapshot.maxIframeDepth ?? 0
          } iframeSrcs=${(bestSnapshot.iframeSrcs || []).join('|') || '-'} preview=${
            bestSnapshot.htmlPreview || '-'
          }`,
        );
      }

      const hasUsefulNestedIframe =
        (bestSnapshot?.allIframeCount ?? 0) > 0 ||
        (bestSnapshot?.maxIframeDepth ?? 0) > 0 ||
        (bestSnapshot?.iframeSrcs?.length ?? 0) > 0;
      const hasSubstantialStandaloneHtml =
        (bestSnapshot?.html.length ?? 0) > 2_000;
      const hasOaiNetworkRecords = networkMonitor
        .getRecords()
        .some((record) => record.url.includes('oaiusercontent.com'));

      if (
        hasUsefulNestedIframe ||
        hasSubstantialStandaloneHtml ||
        hasOaiNetworkRecords
      ) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const networkConversation = parseChatGptConversationNetworkRecords(
      networkMonitor.getRecords(),
      iframeUrl,
    );
    console.info(
      `[gptviewer][shared-deep-research:rendered-network] iframeUrl=${iframeUrl} parsed=${
        networkConversation ? 'yes' : 'no'
      } messages=${networkConversation?.messages.length ?? 0}`,
    );
    if (!networkConversation) {
      console.info(
        `[gptviewer][shared-deep-research:rendered-network-diagnostics]\n${buildChatGptConversationNetworkDiagnostics(
          networkMonitor.getRecords(),
          iframeUrl,
        )}`,
      );
    }

    if (networkConversation) {
      return networkConversation;
    }

    if (!bestSnapshot?.html) {
      console.info(
        `[gptviewer][shared-deep-research:rendered-empty] iframeUrl=${iframeUrl}`,
      );
      return null;
    }

    const parsedConversation = parseChatGptStandaloneHtml(
      bestSnapshot.html,
      bestSnapshot.currentUrl || iframeUrl,
    );

    console.info(
      `[gptviewer][shared-deep-research:rendered-parse] iframeUrl=${iframeUrl} parsed=${
        parsedConversation ? 'yes' : 'no'
      } messages=${parsedConversation?.messages.length ?? 0}`,
    );

    return parsedConversation;
  } catch {
    console.info(
      `[gptviewer][shared-deep-research:rendered-error] iframeUrl=${iframeUrl}`,
    );
    return null;
  } finally {
    await networkMonitor.dispose();
    if (!previewWindow.isDestroyed()) {
      previewWindow.destroy();
    }
  }
};

type RenderedSharedConversationEnhancement = {
  baseConversation: Omit<
    SharedConversationImport,
    'fetchedAt' | 'refreshRequest'
  > | null;
  deepResearchConversation: Omit<
    SharedConversationImport,
    'fetchedAt' | 'refreshRequest'
  > | null;
  deepResearchIframeSrc: string | null;
};

const shouldPreferNetworkSharedConversationBase = (
  currentConversation: Omit<
    SharedConversationImport,
    'fetchedAt' | 'refreshRequest'
  > | null,
  networkConversation: Omit<
    SharedConversationImport,
    'fetchedAt' | 'refreshRequest'
  > | null,
): boolean => {
  if (!networkConversation) {
    return false;
  }

  if (!currentConversation) {
    return true;
  }

  const currentStats = getConversationTextStats(currentConversation);
  const networkStats = getConversationTextStats(networkConversation);

  if (networkStats.assistantChars > currentStats.assistantChars * 1.1) {
    return true;
  }

  if (
    networkStats.messageCount >= Math.max(1, currentStats.messageCount - 8) &&
    networkStats.totalChars > currentStats.totalChars * 1.05
  ) {
    return true;
  }

  return false;
};

const loadRenderedSharedConversationEnhancement = async (
  shareUrl: string,
): Promise<RenderedSharedConversationEnhancement> => {
  const previewWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  previewWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const networkMonitor = new ChatGptConversationNetworkMonitor(
    previewWindow.webContents,
  );

  try {
    showPreviewWindowInBackground(previewWindow);
    const networkMonitorReadyPromise = networkMonitor
      .ready()
      .catch((): void => undefined);
    await previewWindow.loadURL(shareUrl, {
      httpReferrer: shareUrl,
    });
    console.info(
      `[gptviewer][shared-deep-research:rendered-share-load] url=${shareUrl}`,
    );
    await Promise.race([
      networkMonitorReadyPromise,
      new Promise((resolve) => setTimeout(resolve, 1_500)),
    ]);

    const deadline = Date.now() + 14_000;
    let bestConversationSnapshot: ExtractedConversationHtmlSnapshot | null =
      null;
    let bestStandaloneSnapshot: ExtractedStandaloneHtmlSnapshot | null = null;
    let discoveredIframeSrc: string | null = null;
    let deepResearchDetectedAt: number | null = null;

    while (Date.now() < deadline && !previewWindow.isDestroyed()) {
      try {
        await previewWindow.webContents.executeJavaScript(
          buildActivateDeepResearchEmbedsScript(),
          true,
        );
      } catch {
        // Ignore activation failures and continue probing.
      }

      const [conversationSnapshot, standaloneSnapshot] = await Promise.all([
        previewWindow.webContents.executeJavaScript(
          buildExtractConversationHtmlSnapshotScript(),
          true,
        ),
        previewWindow.webContents.executeJavaScript(
          buildExtractStandaloneHtmlSnapshotScript(),
          true,
        ),
      ]);

      if (
        conversationSnapshot &&
        typeof conversationSnapshot === 'object' &&
        'blocks' in conversationSnapshot &&
        Array.isArray(conversationSnapshot.blocks)
      ) {
        const typedSnapshot =
          conversationSnapshot as ExtractedConversationHtmlSnapshot;
        const blockCount = typedSnapshot.blocks.length;
        const conversationHtmlLength =
          typedSnapshot.conversationHtml?.length ?? 0;
        const currentBestBlockCount = bestConversationSnapshot?.blocks.length ?? 0;
        const currentBestHtmlLength =
          bestConversationSnapshot?.conversationHtml?.length ?? 0;

        if (
          blockCount > currentBestBlockCount ||
          (blockCount === currentBestBlockCount &&
            conversationHtmlLength > currentBestHtmlLength)
        ) {
          bestConversationSnapshot = typedSnapshot;
          console.info(
            `[gptviewer][shared-deep-research:rendered-share-snapshot] url=${shareUrl} blocks=${blockCount} html=${conversationHtmlLength}`,
          );
        }

        const blockIframeSrc =
          typedSnapshot.blocks.find((block) => !!block.deepResearchIframeSrc)
            ?.deepResearchIframeSrc ?? null;
        if (
          isMeaningfulDeepResearchUrl(blockIframeSrc) &&
          blockIframeSrc !== discoveredIframeSrc
        ) {
          discoveredIframeSrc = blockIframeSrc;
          deepResearchDetectedAt = Date.now();
          console.info(
            `[gptviewer][shared-deep-research:rendered-share-iframe] url=${shareUrl} iframeUrl=${blockIframeSrc}`,
          );
        }
      }

      if (
        standaloneSnapshot &&
        typeof standaloneSnapshot === 'object' &&
        'html' in standaloneSnapshot &&
        typeof standaloneSnapshot.html === 'string'
      ) {
        const typedSnapshot =
          standaloneSnapshot as ExtractedStandaloneHtmlSnapshot;
        const looksLikeNestedStandalone =
          (typedSnapshot.maxIframeDepth ?? 0) > 0 ||
          (typedSnapshot.currentUrl || '') !== shareUrl ||
          (typedSnapshot.iframeSrcs || []).some((iframeSrc) =>
            isMeaningfulDeepResearchUrl(iframeSrc),
          );
        if (
          looksLikeNestedStandalone &&
          (typedSnapshot.html.length > (bestStandaloneSnapshot?.html.length ?? 0) ||
            (typedSnapshot.iframeSrcs || []).some((iframeSrc) =>
              isMeaningfulDeepResearchUrl(iframeSrc),
            ))
        ) {
          bestStandaloneSnapshot = typedSnapshot;
          console.info(
            `[gptviewer][shared-deep-research:rendered-share-standalone] url=${shareUrl} currentUrl=${
              typedSnapshot.currentUrl || shareUrl
            } html=${typedSnapshot.html.length} iframeCount=${
              typedSnapshot.iframeCount ?? 0
            } allIframeCount=${typedSnapshot.allIframeCount ?? 0} depth=${
              typedSnapshot.maxIframeDepth ?? 0
            } iframeSrcs=${(typedSnapshot.iframeSrcs || []).join('|') || '-'} preview=${
              typedSnapshot.htmlPreview || '-'
            }`,
          );
        }
      }

      const subframeSnapshot = await extractBestStandaloneSnapshotFromSubframes(
        previewWindow,
      );
      if (
        subframeSnapshot &&
        subframeSnapshot.html.length > (bestStandaloneSnapshot?.html.length ?? 0)
      ) {
        bestStandaloneSnapshot = subframeSnapshot;
        console.info(
          `[gptviewer][shared-deep-research:rendered-share-subframe] url=${shareUrl} frameUrl=${
            subframeSnapshot.frameUrl || '-'
          } origin=${subframeSnapshot.frameOrigin || '-'} html=${
            subframeSnapshot.html.length
          } iframeCount=${subframeSnapshot.iframeCount ?? 0} allIframeCount=${
            subframeSnapshot.allIframeCount ?? 0
          } depth=${subframeSnapshot.maxIframeDepth ?? 0} preview=${
            subframeSnapshot.htmlPreview || '-'
          }`,
        );
      }

      const hasUsefulStandaloneSnapshot =
        (bestStandaloneSnapshot?.allIframeCount ?? 0) > 0 ||
        (bestStandaloneSnapshot?.maxIframeDepth ?? 0) > 0 ||
        (bestStandaloneSnapshot?.iframeSrcs?.length ?? 0) > 0 ||
        (bestStandaloneSnapshot?.html.length ?? 0) > 2_000;
      const hasOaiNetworkRecords = networkMonitor
        .getRecords()
        .some((record) => record.url.includes('oaiusercontent.com'));
      const iframeGraceElapsed =
        deepResearchDetectedAt !== null && Date.now() - deepResearchDetectedAt > 4_000;

      if (
        (bestConversationSnapshot?.blocks.length ?? 0) > 0 &&
        (hasUsefulStandaloneSnapshot || hasOaiNetworkRecords)
      ) {
        break;
      }

      if (
        (bestConversationSnapshot?.blocks.length ?? 0) > 0 &&
        discoveredIframeSrc &&
        iframeGraceElapsed
      ) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const snapshotBaseConversation = bestConversationSnapshot
      ? parseChatGptConversationHtmlSnapshot(bestConversationSnapshot, shareUrl)
      : null;
    const networkConversation = parseChatGptConversationNetworkRecords(
      networkMonitor.getRecords(),
      shareUrl,
    );
    const baseConversation = shouldPreferNetworkSharedConversationBase(
      snapshotBaseConversation,
      networkConversation,
    )
      ? networkConversation
      : snapshotBaseConversation;
    const deepResearchConversation =
      bestStandaloneSnapshot &&
      ((bestStandaloneSnapshot.currentUrl || '') !== shareUrl ||
        (bestStandaloneSnapshot.maxIframeDepth ?? 0) > 0)
        ? parseChatGptStandaloneHtml(
            bestStandaloneSnapshot.html,
            bestStandaloneSnapshot.currentUrl || shareUrl,
          )
        : null;

    console.info(
      `[gptviewer][shared-deep-research:rendered-share-network] url=${shareUrl} parsed=${
        networkConversation ? 'yes' : 'no'
      } messages=${networkConversation?.messages.length ?? 0}`,
    );
    if (!networkConversation) {
      console.info(
        `[gptviewer][shared-deep-research:rendered-share-network-diagnostics]\n${buildChatGptConversationNetworkDiagnostics(
          networkMonitor.getRecords(),
          shareUrl,
        )}`,
      );
    }
    console.info(
      `[gptviewer][shared-deep-research:rendered-share-parse] url=${shareUrl} baseParsed=${
        baseConversation ? 'yes' : 'no'
      } baseMessages=${baseConversation?.messages.length ?? 0} iframeParsed=${
        deepResearchConversation ? 'yes' : 'no'
      } iframeMessages=${deepResearchConversation?.messages.length ?? 0}`,
    );

    const fallbackStandaloneIframeSrc =
      bestStandaloneSnapshot &&
      (isMeaningfulDeepResearchUrl(bestStandaloneSnapshot.currentUrl) ||
        (bestStandaloneSnapshot.iframeSrcs || []).some((iframeSrc) =>
          isMeaningfulDeepResearchUrl(iframeSrc),
        ) ||
        (((bestStandaloneSnapshot.currentUrl || '') !== shareUrl) &&
          (bestStandaloneSnapshot.maxIframeDepth ?? 0) > 0))
        ? isMeaningfulDeepResearchUrl(bestStandaloneSnapshot.currentUrl)
          ? bestStandaloneSnapshot.currentUrl
          : (bestStandaloneSnapshot.iframeSrcs || []).find((iframeSrc) =>
              isMeaningfulDeepResearchUrl(iframeSrc),
            ) || null
        : null;

    return {
      baseConversation,
      deepResearchConversation,
      deepResearchIframeSrc: discoveredIframeSrc ?? fallbackStandaloneIframeSrc,
    };
  } catch {
    console.info(
      `[gptviewer][shared-deep-research:rendered-share-error] url=${shareUrl}`,
    );
    return {
      baseConversation: null,
      deepResearchConversation: null,
      deepResearchIframeSrc: null,
    };
  } finally {
    await networkMonitor.dispose();
    if (!previewWindow.isDestroyed()) {
      previewWindow.destroy();
    }
  }
};

const loadSharedConversation = async (
  url: string,
): Promise<SharedConversationImport> => {
  const response = await fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    throw new Error(`공유 대화를 불러오지 못했습니다. (${response.status})`);
  }

  const finalUrl = response.url || url;
  const html = await response.text();
  let parsedConversation = extractSharedConversationFromHtml(html, finalUrl);
  const staticDeepResearchIframeSrc = extractDeepResearchIframeSrcFromHtml(
    html,
    finalUrl,
  );
  let importWarning: SharedConversationImportWarning | undefined;
  let deepResearchIframeSrc = staticDeepResearchIframeSrc;
  console.info(
    `[gptviewer][shared-load] url=${finalUrl} baseParsed=${
      parsedConversation ? 'yes' : 'no'
    } baseMessages=${parsedConversation?.messages.length ?? 0} deepResearchIframe=${
      deepResearchIframeSrc ?? '-'
    }`,
  );

  let deepResearchConversation: Omit<
    SharedConversationImport,
    'fetchedAt' | 'refreshRequest'
  > | null = null;

  if (!deepResearchIframeSrc) {
    const renderedEnhancement = await loadRenderedSharedConversationEnhancement(
      finalUrl,
    );

    const mergedRenderedBase = mergeRenderedSharedConversationBase(
      parsedConversation,
      renderedEnhancement.baseConversation,
    );

    const staticStats = getConversationTextStats(parsedConversation);
    const renderedStats = getConversationTextStats(
      renderedEnhancement.baseConversation,
    );
    const mergedBaseStats = getConversationTextStats(mergedRenderedBase);
    const preferRenderedBase = shouldPreferRenderedSharedConversationBase(
      parsedConversation,
      renderedEnhancement.baseConversation,
      staticDeepResearchIframeSrc,
    );
    const preferMergedBase =
      !!mergedRenderedBase &&
      mergedRenderedBase !== parsedConversation &&
      mergedBaseStats.assistantChars >
        Math.max(staticStats.assistantChars, renderedStats.assistantChars) *
          1.02;

    const baseChoice = preferMergedBase
      ? 'merged'
      : preferRenderedBase
        ? 'rendered'
        : mergedRenderedBase !== parsedConversation
          ? 'merged'
          : parsedConversation
          ? 'static'
          : 'rendered';
    const shouldWarnAboutSharedDeepResearchGap =
      !renderedEnhancement.deepResearchConversation &&
      !!renderedEnhancement.baseConversation &&
      (preferMergedBase ||
        preferRenderedBase ||
        renderedStats.messageCount !== staticStats.messageCount ||
        renderedStats.assistantChars > staticStats.assistantChars * 1.01 ||
        mergedBaseStats.assistantChars > staticStats.assistantChars * 1.01);

    console.info(
      `[gptviewer][shared-deep-research:rendered-share-compare] url=${finalUrl} staticMessages=${staticStats.messageCount} staticAssistantChars=${staticStats.assistantChars} renderedMessages=${renderedStats.messageCount} renderedAssistantChars=${renderedStats.assistantChars} mergedMessages=${mergedBaseStats.messageCount} mergedAssistantChars=${mergedBaseStats.assistantChars} choose=${baseChoice}`,
    );

    if (preferMergedBase && mergedRenderedBase) {
      parsedConversation = mergedRenderedBase;
    } else if (preferRenderedBase && renderedEnhancement.baseConversation) {
      parsedConversation = renderedEnhancement.baseConversation;
    } else if (mergedRenderedBase) {
      parsedConversation = mergedRenderedBase;
    }

    if (
      !deepResearchIframeSrc &&
      isMeaningfulDeepResearchUrl(renderedEnhancement.deepResearchIframeSrc)
    ) {
      deepResearchIframeSrc = renderedEnhancement.deepResearchIframeSrc;
    }

    if (!deepResearchConversation && renderedEnhancement.deepResearchConversation) {
      deepResearchConversation = renderedEnhancement.deepResearchConversation;
    }

    if (shouldWarnAboutSharedDeepResearchGap) {
      importWarning = {
        code: 'shared-deep-research-partial',
        message: SHARED_DEEP_RESEARCH_WARNING_MESSAGE,
      };
    }

    console.info(
      `[gptviewer][shared-deep-research:rendered-share-merge-source] url=${finalUrl} baseParsed=${
        parsedConversation ? 'yes' : 'no'
      } baseMessages=${parsedConversation?.messages.length ?? 0} deepResearchIframe=${deepResearchIframeSrc ?? '-'} iframeMessages=${
        deepResearchConversation?.messages.length ?? 0
      }`,
    );
  }

  if (deepResearchConversation) {
    importWarning = undefined;
  }

  if (isMeaningfulDeepResearchUrl(deepResearchIframeSrc)) {
    try {
      const iframeResponse = await fetch(deepResearchIframeSrc, {
        headers: {
          accept: 'text/html,application/xhtml+xml',
          referer: finalUrl,
        },
      });

      if (iframeResponse.ok) {
        const iframeHtml = await iframeResponse.text();
        deepResearchConversation = parseChatGptStandaloneHtml(
          iframeHtml,
          deepResearchIframeSrc,
        );
        console.info(
          `[gptviewer][shared-deep-research:static-fetch] iframeUrl=${deepResearchIframeSrc} status=${iframeResponse.status} html=${iframeHtml.length} parsed=${
            deepResearchConversation ? 'yes' : 'no'
          } messages=${deepResearchConversation?.messages.length ?? 0}`,
        );
      } else {
        console.info(
          `[gptviewer][shared-deep-research:static-fetch] iframeUrl=${deepResearchIframeSrc} status=${iframeResponse.status} html=0 parsed=no messages=0`,
        );
      }
    } catch {
      console.info(
        `[gptviewer][shared-deep-research:static-fetch-error] iframeUrl=${deepResearchIframeSrc}`,
      );
      deepResearchConversation = null;
    }

    if (!deepResearchConversation) {
      deepResearchConversation = await loadRenderedStandaloneConversation(
        deepResearchIframeSrc,
      );
    }
  }

  const mergedConversation = mergeDeepResearchMessages(
    parsedConversation,
    deepResearchConversation,
    finalUrl,
  );
  console.info(
    `[gptviewer][shared-deep-research:merge] base=${
      parsedConversation ? parsedConversation.messages.length : 0
    } iframe=${deepResearchConversation ? deepResearchConversation.messages.length : 0} merged=${
      mergedConversation ? mergedConversation.messages.length : 0
    }`,
  );

  if (!mergedConversation) {
    throw new Error('공유 페이지에서 대화 내용을 찾지 못했습니다.');
  }

  return {
    fetchedAt: new Date().toISOString(),
    importWarning,
    refreshRequest: {
      mode: 'direct-share-page',
      shareUrl: finalUrl,
    },
    ...mergedConversation,
  };
};

const sharedConversationRefreshService = new SharedConversationRefreshService({
  loadSharedConversation,
});
const projectConversationImportService = new ProjectConversationImportService();

const loadRenderedSourcePreview = async (
  sourceUrl: string,
): Promise<SourcePreviewSnapshot | null> => {
  const previewWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  previewWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const waitForSettledContent = async (): Promise<SourcePreviewSnapshot | null> => {
    const deadline = Date.now() + 5000;

    while (Date.now() < deadline && !previewWindow.isDestroyed()) {
      const snapshot = (await previewWindow.webContents.executeJavaScript(
        SOURCE_PREVIEW_EXTRACTION_SCRIPT,
        true,
      )) as SourcePreviewSnapshot;

      if (
        snapshot.description ||
        snapshot.headings.length > 0 ||
        snapshot.paragraphs.length > 0
      ) {
        return snapshot;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 350);
      });
    }

    if (previewWindow.isDestroyed()) {
      return null;
    }

    return (await previewWindow.webContents.executeJavaScript(
      SOURCE_PREVIEW_EXTRACTION_SCRIPT,
      true,
    )) as SourcePreviewSnapshot;
  };

  try {
    await previewWindow.loadURL(sourceUrl);
    return await waitForSettledContent();
  } catch {
    return null;
  } finally {
    if (!previewWindow.isDestroyed()) {
      previewWindow.destroy();
    }
  }
};

ipcMain.handle('shared-conversation:fetch', async (_event, rawUrl: string) => {
  const normalizedUrl = rawUrl.trim();

  if (!normalizedUrl) {
    throw new Error('공유 URL을 입력해 주세요.');
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(normalizedUrl);
  } catch {
    throw new Error('올바른 URL 형식이 아닙니다.');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('http 또는 https 주소만 불러올 수 있습니다.');
  }

  try {
    return await loadSharedConversation(parsedUrl.toString());
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : '공유 대화를 불러오지 못했습니다.',
    );
  }
});

ipcMain.handle(
  'project-conversation:collect',
  async (event: IpcMainInvokeEvent, request: ProjectConversationImportRequest) => {
    if (!request || typeof request !== 'object') {
      throw new Error('프로젝트 불러오기 요청이 올바르지 않습니다.');
    }

    try {
      return (await projectConversationImportService.collectProject(
        request.projectUrl,
        (progress: ProjectConversationImportProgress) => {
          event.sender.send('project-conversation:progress', progress);
        },
      )) as ProjectConversationCollectionResult;
    } catch (error) {
      if (error instanceof SharedConversationRefreshError) {
        throw new Error(
          encodeSharedConversationRefreshError({
            code: error.code,
            detail: error.detail,
            message: error.message,
          }),
        );
      }
      throw new Error(
        error instanceof Error
          ? error.message
          : '프로젝트 대화를 불러오지 못했습니다.',
      );
    }
  },
);

ipcMain.handle(
  'chatgpt-automation:cleanup-background-pool',
  async () => {
    await ChatGptAutomationView.drainBackgroundPool();
  },
);

ipcMain.handle(
  'chatgpt-automation:reset-session-state',
  async () => {
    await ChatGptAutomationView.resetSessionState();
  },
);

ipcMain.handle(
  'shared-conversation:refresh',
  async (_event, request: SharedConversationRefreshRequest) => {
    if (!request || typeof request !== 'object') {
      throw new Error('새로고침 요청이 올바르지 않습니다.');
    }

    try {
      return await sharedConversationRefreshService.refreshConversation(request);
    } catch (error) {
      if (error instanceof SharedConversationRefreshError) {
        throw new Error(
          encodeSharedConversationRefreshError({
            code: error.code,
            detail: error.detail,
            message: error.message,
          }),
        );
      }
      throw new Error(
        error instanceof Error
          ? error.message
          : '공유 대화를 새로고침하지 못했습니다.',
      );
    }
  },
);

ipcMain.handle(
  'chatgpt-conversation:import',
  async (_event, request: SharedConversationRefreshRequest) => {
    if (!request || typeof request !== 'object') {
      throw new Error('원본 대화 가져오기 요청이 올바르지 않습니다.');
    }

    try {
      return await sharedConversationRefreshService.importConversationFromChatUrl(
        request,
      );
    } catch (error) {
      if (error instanceof SharedConversationRefreshError) {
        throw new Error(
          encodeSharedConversationRefreshError({
            code: error.code,
            detail: error.detail,
            message: error.message,
          }),
        );
      }

      throw new Error(
        error instanceof Error
          ? error.message
          : '원본 ChatGPT 대화를 가져오지 못했습니다.',
      );
    }
  },
);

ipcMain.handle(
  'chatgpt-image:resolve',
  async (_event, rawChatUrl: string, rawAssetUrl: string) => {
    const normalizedChatUrl = normalizeChatGptConversationUrl(rawChatUrl);
    const normalizedAssetUrl = String(rawAssetUrl || '').trim();
    if (!normalizedChatUrl || !normalizedAssetUrl) {
      return null;
    }

    const cacheKey = buildChatGptImageAssetCacheKey(
      normalizedChatUrl,
      normalizedAssetUrl,
    );
    const cachedEntry = chatGptImageAssetCache.get(cacheKey);
    if (cachedEntry) {
      console.info(
        `[gptviewer][chatgpt-image:cache-hit] key=${cacheKey}`,
      );
      return cachedEntry;
    }

    const inFlightTask = chatGptImageAssetInFlight.get(cacheKey);
    if (inFlightTask) {
      console.info(
        `[gptviewer][chatgpt-image:duplicate-ignored] key=${cacheKey}`,
      );
      return inFlightTask;
    }

    const queuedTask = enqueueChatGptImageResolveTask(
      cacheKey,
      normalizedChatUrl,
      normalizedAssetUrl,
    );
    chatGptImageAssetInFlight.set(cacheKey, queuedTask);
    return queuedTask;
  },
);

ipcMain.handle('source-preview:fetch', async (_event, rawUrl: string) => {
  const normalizedUrl = rawUrl.trim();

  if (!normalizedUrl) {
    throw new Error('출처 URL을 입력해 주세요.');
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(normalizedUrl);
  } catch {
    throw new Error('올바른 출처 URL 형식이 아닙니다.');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('http 또는 https 주소만 불러올 수 있습니다.');
  }

  try {
    const normalizedUrl = parsedUrl.toString();
    const renderedPreview = await loadRenderedSourcePreview(normalizedUrl);

    if (renderedPreview) {
      return buildSourcePreviewFromSnapshot(renderedPreview);
    }

    const response = await fetch(normalizedUrl, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return { url: normalizedUrl };
    }

    return buildSourcePreviewFromHtml(
      await response.text(),
      response.url || normalizedUrl,
    );
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : '출처 미리보기를 불러오지 못했습니다.',
    );
  }
});

ipcMain.handle(
  'source-icon:fetch',
  async (_event, rawIconUrl: string, rawRefererUrl?: string) => {
    const normalizedIconUrl = rawIconUrl.trim();

    if (!normalizedIconUrl) {
      return null;
    }

    let parsedIconUrl: URL;

    try {
      parsedIconUrl = new URL(normalizedIconUrl);
    } catch {
      throw new Error('올바른 아이콘 URL 형식이 아닙니다.');
    }

    if (!['http:', 'https:'].includes(parsedIconUrl.protocol)) {
      throw new Error('http 또는 https 아이콘 주소만 불러올 수 있습니다.');
    }

    let referer: string | undefined;

    if (typeof rawRefererUrl === 'string' && rawRefererUrl.trim()) {
      try {
        const parsedRefererUrl = new URL(rawRefererUrl.trim());
        if (['http:', 'https:'].includes(parsedRefererUrl.protocol)) {
          referer = parsedRefererUrl.toString();
        }
      } catch {
        referer = undefined;
      }
    }

    try {
      const response = await fetch(parsedIconUrl.toString(), {
        headers: {
          accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          ...(referer ? { referer } : {}),
          'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        return null;
      }

      return toSourceIconImport(response, parsedIconUrl.toString());
    } catch {
      return null;
    }
  },
);

registerGoogleDriveSyncIpc();

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#0b1014',
    autoHideMenuBar: true,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  void mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
};

app.on('ready', () => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
