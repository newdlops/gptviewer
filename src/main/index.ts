import { app, BrowserWindow, ipcMain, shell } from 'electron';
import type {
  SharedConversationImport,
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
import { SharedConversationRefreshService } from './services/sharedConversationRefresh/SharedConversationRefreshService';
import { SharedConversationRefreshError } from './services/sharedConversationRefresh/SharedConversationRefreshError';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

type SourceIconImport = {
  contentType?: string;
  dataUrl: string;
  finalUrl: string;
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
  const parsedConversation = extractSharedConversationFromHtml(html, finalUrl);

  if (!parsedConversation) {
    throw new Error('공유 페이지에서 대화 내용을 찾지 못했습니다.');
  }

  return {
    fetchedAt: new Date().toISOString(),
    refreshRequest: {
      mode: 'direct-share-page',
      shareUrl: finalUrl,
    },
    ...parsedConversation,
  };
};

const sharedConversationRefreshService = new SharedConversationRefreshService({
  loadSharedConversation,
});

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
