type ExtractedConversationHtmlBlock = {
  deepResearchIframeSrc?: string;
  html: string;
  role: 'assistant' | 'user';
};

type ExtractedConversationHtmlSnapshot = {
  blocks: ExtractedConversationHtmlBlock[];
  conversationHtml: string;
  currentUrl: string;
  title: string;
};

type ExtractedStandaloneHtmlSnapshot = {
  allIframeCount?: number;
  currentUrl: string;
  html: string;
  htmlPreview?: string;
  iframeCount?: number;
  iframeSrcs?: string[];
  maxIframeDepth?: number;
  title: string;
};

type ExtractedConversationHtmlReadiness = {
  conversationHtmlLength: number;
  hasLoadingIndicator: boolean;
  hasMain: boolean;
  messageCount: number;
  readyState: string;
};

type FetchedConversationJsonPayload = {
  bodyText: string;
  ok: boolean;
  status: number;
  url: string;
};

type FetchedConversationAssetPayload = {
  contentType?: string;
  dataUrl?: string;
  error?: string;
  fileId: string;
  ok: boolean;
  status: number;
  url?: string;
};

type ReplayRequestHeaders = Record<string, string>;

const MERMAID_LOADING_TEXT_PATTERN_SOURCE =
  '^(?:mermaid\\\\s*)?(?:다이어그램\\\\s*)?불러오는 중(?:\\\\.{3}|…)?$';

export const buildPrepareConversationHtmlSnapshotScript = () => `
(() => {
  const isVisible = (element) => (
    element instanceof HTMLElement &&
    element.getBoundingClientRect().width > 0 &&
    element.getBoundingClientRect().height > 0 &&
    window.getComputedStyle(element).display !== 'none' &&
    window.getComputedStyle(element).visibility !== 'hidden' &&
    !element.hasAttribute('hidden')
  );

  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const main = document.querySelector('main') || document.body;
  let clicked = 0;

  Array.from(main.querySelectorAll('button, [role="button"]')).forEach((element) => {
    if (!(element instanceof HTMLElement) || !isVisible(element)) {
      return;
    }

    const label = normalize(
      element.getAttribute('aria-label') ||
      element.getAttribute('title') ||
      element.textContent ||
      '',
    );

    if (!label) {
      return;
    }

    const isCodeToggle =
      /^(코드 보기|view code|show code|code view|show source|source)$/i.test(label) ||
      label.includes('코드 보기') ||
      label.includes('view code') ||
      label.includes('show code') ||
      label.includes('show source');
    const isExcluded =
      label.includes('복사') ||
      label.includes('copy') ||
      label.includes('공유') ||
      label.includes('share');

    if (!isCodeToggle || isExcluded) {
      return;
    }

    element.click();
    clicked += 1;
  });

  return { clicked };
})()
`;

export const buildInspectConversationHtmlReadinessScript = () => `
(() => {
  const isVisible = (element) => (
    element instanceof HTMLElement &&
    element.getBoundingClientRect().width > 0 &&
    element.getBoundingClientRect().height > 0 &&
    window.getComputedStyle(element).display !== 'none' &&
    window.getComputedStyle(element).visibility !== 'hidden' &&
    !element.hasAttribute('hidden')
  );

  const main = document.querySelector('main');
  const root = main || document.body;
  const messageNodes = Array.from(
    root.querySelectorAll(
      'article, [data-message-author-role], [data-testid*="message"], [data-testid*="conversation-turn"]',
    ),
  ).filter((node) => isVisible(node));
  const hasLoadingIndicator = Array.from(
    document.querySelectorAll(
      '[role="progressbar"], .animate-spin, [data-testid*="loading"], [aria-busy="true"]',
    ),
  ).some((node) => isVisible(node));

  return {
    conversationHtmlLength: (main?.outerHTML || '').length,
    hasLoadingIndicator,
    hasMain: main instanceof HTMLElement,
    messageCount: messageNodes.length,
    readyState: document.readyState,
  };
})()
`;

export const buildFetchConversationJsonScript = (
  conversationId: string,
  replayHeaders: ReplayRequestHeaders = {},
) => `
(async () => {
  const replayHeaders = ${JSON.stringify(replayHeaders)};
  const headers = {
    accept: 'application/json',
    ...replayHeaders,
  };
  const response = await fetch(
    ${JSON.stringify(`/backend-api/conversation/${conversationId}`)},
    {
      cache: 'no-store',
      credentials: 'include',
      headers,
      method: 'GET',
      mode: 'same-origin',
      referrer: location.href,
    },
  );

  return {
    bodyText: await response.text(),
    ok: response.ok,
    status: response.status,
    url: response.url,
  };
})()
`;

export const buildFetchConversationAssetDataUrlScript = (
  fileId: string,
  replayHeaders: ReplayRequestHeaders = {},
  conversationId = '',
  referrerUrl = '',
) => `
(async () => {
  const inputFileId = ${JSON.stringify(fileId)};
  const replayHeaders = ${JSON.stringify(replayHeaders)};
  const conversationId = ${JSON.stringify(conversationId)};
  const requestReferrer = ${JSON.stringify(referrerUrl)};
  const FETCH_TIMEOUT_MS = 30_000;
  const normalizedFileId = String(inputFileId)
    .trim()
    .replace(/^sediment:\\/\\//i, '');
  const fetchWithTimeout = async (url, init) => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, FETCH_TIMEOUT_MS);
    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const inferMimeTypeFromBytes = (bytes) => {
    if (!bytes || bytes.length < 4) {
      return '';
    }

    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      return 'image/png';
    }

    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg';
    }

    if (
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x38
    ) {
      return 'image/gif';
    }

    if (
      bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return 'image/webp';
    }

    if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
      return 'image/bmp';
    }

    if (
      bytes.length >= 12 &&
      bytes[4] === 0x66 &&
      bytes[5] === 0x74 &&
      bytes[6] === 0x79 &&
      bytes[7] === 0x70
    ) {
      const brand = String.fromCharCode(
        bytes[8] || 0,
        bytes[9] || 0,
        bytes[10] || 0,
        bytes[11] || 0,
      );
      if (brand === 'avif' || brand === 'avis') {
        return 'image/avif';
      }
    }

    return '';
  };

  const reencodeBlobToPngDataUrl = async (blob) => {
    try {
      const imageBitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = imageBitmap.width || 1;
      canvas.height = imageBitmap.height || 1;
      const context = canvas.getContext('2d');
      if (!context) {
        imageBitmap.close();
        return '';
      }
      context.drawImage(imageBitmap, 0, 0);
      imageBitmap.close();
      const pngDataUrl = canvas.toDataURL('image/png');
      return typeof pngDataUrl === 'string' ? pngDataUrl : '';
    } catch {
      return '';
    }
  };

  const toDataUrl = async (response, preferredMimeType = '') => {
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const inferredMimeType = inferMimeTypeFromBytes(bytes);
    const mimeType =
      (preferredMimeType || '').toLowerCase().startsWith('image/')
        ? preferredMimeType
        : inferredMimeType || preferredMimeType || 'application/octet-stream';
    const blob = new Blob([bytes], { type: mimeType });
    if (!String(mimeType).toLowerCase().startsWith('image/')) {
      const reencodedPngDataUrl = await reencodeBlobToPngDataUrl(blob);
      if (reencodedPngDataUrl) {
        return reencodedPngDataUrl;
      }
    }
    return await new Promise((resolve, reject) => {
      try {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('file_reader_failed'));
        reader.readAsDataURL(blob);
      } catch (error) {
        reject(error);
      }
    });
  };

  const collectCandidateUrlsFromJson = (value, visited = new WeakSet()) => {
    if (!value) {
      return [];
    }

    if (typeof value === 'string') {
      if (/^https?:\\/\\//i.test(value.trim())) {
        return [value.trim()];
      }
      return [];
    }

    if (Array.isArray(value)) {
      return value.flatMap((entry) => collectCandidateUrlsFromJson(entry, visited));
    }

    if (typeof value !== 'object') {
      return [];
    }

    if (visited.has(value)) {
      return [];
    }
    visited.add(value);

    const record = value;
    const directUrlKeys = [
      'download_url',
      'downloadUrl',
      'signed_url',
      'signedUrl',
      'url',
      'asset_pointer_link',
      'image_url',
      'imageUrl',
    ];

    const directUrls = directUrlKeys
      .map((key) => record?.[key])
      .filter((entry) => typeof entry === 'string')
      .map((entry) => String(entry).trim())
      .filter((entry) => /^https?:\\/\\//i.test(entry));

    const nestedUrls = Object.values(record).flatMap((entry) =>
      collectCandidateUrlsFromJson(entry, visited),
    );

    return [...new Set([...directUrls, ...nestedUrls])];
  };

  const defaultHeaders = {
    ...replayHeaders,
    accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  };

  const isRedirectStatus = (status) =>
    status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
  const isLikelyRenderableImageUrl = (value) => {
    const normalizedValue = String(value || '').trim();
    if (!/^https?:\\/\\//i.test(normalizedValue)) {
      return false;
    }

    return (
      /\\.(png|jpe?g|gif|webp|avif|bmp|svg)(?:[?#].*)?$/i.test(normalizedValue) ||
      /oaiusercontent\\.com/i.test(normalizedValue) ||
      /\\/backend-api\\/estuary\\/content\\b/i.test(normalizedValue) ||
      /[?&]id=file_[a-z0-9_-]+/i.test(normalizedValue) ||
      /\\/image\\//i.test(normalizedValue) ||
      /\\/images\\//i.test(normalizedValue)
    );
  };

  const extractCandidateUrlsFromText = (value) => {
    const text = String(value || '');
    return [
      ...new Set(
        (
          text.match(
            /(https?:\\/\\/[^\\s"'<>]+|\\/\\/[^\\s"'<>]+|\\/backend-api\\/[^\\s"'<>]+)/gi,
          ) || []
        ).map((entry) => String(entry).trim()),
      ),
    ];
  };

  const fetchImageDataUrlFromUrl = async (
    candidateUrl,
    preferCredentials = false,
    depth = 0,
  ) => {
    if (depth > 4) {
      return null;
    }

    try {
      const targetUrl = new URL(candidateUrl, location.origin);
      const isSameOrigin = targetUrl.origin === location.origin;
      const response = await fetchWithTimeout(targetUrl.toString(), {
        cache: 'no-store',
        credentials: isSameOrigin
          ? 'include'
          : preferCredentials
            ? 'include'
            : 'omit',
        headers: isSameOrigin ? defaultHeaders : undefined,
        method: 'GET',
        mode: 'cors',
        redirect: 'follow',
        referrer: requestReferrer || location.href,
      });

      if (!response.ok) {
        return null;
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (
        contentType.includes('application/json') ||
        contentType.includes('text/plain')
      ) {
        const responseText = await response.text().catch(() => '');
        const parsedPayload = (() => {
          try {
            return JSON.parse(responseText);
          } catch {
            return null;
          }
        })();
        const nestedUrls = parsedPayload
          ? collectCandidateUrlsFromJson(parsedPayload)
          : extractCandidateUrlsFromText(responseText);

        for (const nestedUrl of nestedUrls) {
          if (!nestedUrl || nestedUrl === candidateUrl) {
            continue;
          }

          const nestedResult = await fetchImageDataUrlFromUrl(
            nestedUrl,
            preferCredentials,
            depth + 1,
          );
          if (nestedResult) {
            return nestedResult;
          }
        }

        return null;
      }

      const dataUrl = await toDataUrl(response, contentType);
      if (!dataUrl || !String(dataUrl).toLowerCase().startsWith('data:image/')) {
        return null;
      }

      return {
        contentType,
        dataUrl,
        status: response.status,
        url: response.url || targetUrl.toString(),
      };
    } catch {
      return null;
    }
  };

  const compactFileIdCandidates = [
    ...new Set([
      normalizedFileId,
      normalizedFileId.replace(/^file_/i, 'file-'),
    ]),
  ].filter((candidateId) => /^file[-_][a-z0-9_-]+$/i.test(candidateId));
  const encodedConversationId = encodeURIComponent(conversationId || '');

  // estuary/content 패턴 (최신 ChatGPT 이미지 서빙 방식)
  const estuaryCandidatePaths = compactFileIdCandidates.flatMap((candidateId) => {
    // 원본 assetUrl에서 쿼리 파라미터가 있었다면 이를 최대한 활용해야 함
    // 여기서는 기본 구조를 먼저 시도
    const baseEstuaryPath = '/backend-api/estuary/content?id=' + candidateId;
    if (!encodedConversationId) return [baseEstuaryPath];
    return [
      baseEstuaryPath + '&cid=' + encodedConversationId,
      baseEstuaryPath
    ];
  });

  const primaryCandidatePaths = compactFileIdCandidates.flatMap((candidateId) => {
    const downloadPath = '/backend-api/files/download/' + candidateId;
    const resourcePath = '/backend-api/files/' + candidateId + '/download';
    if (!encodedConversationId) {
      return [downloadPath, resourcePath];
    }
    return [
      downloadPath + '?conversation_id=' + encodedConversationId + '&inline=false',
      downloadPath + '?conversation_id=' + encodedConversationId,
      downloadPath,
      resourcePath + '?conversation_id=' + encodedConversationId + '&inline=false',
      resourcePath + '?conversation_id=' + encodedConversationId,
      resourcePath,
    ];
  });
  const fallbackCandidatePaths = compactFileIdCandidates.flatMap((candidateId) => [
    '/backend-api/files/' + candidateId,
    '/backend-api/files/' + candidateId + '?download=true',
    '/backend-api/files/' + candidateId + '/content',
  ]);
  const candidatePaths = [
    ...new Set([...estuaryCandidatePaths, ...primaryCandidatePaths, ...fallbackCandidatePaths]),
  ].slice(0, 20);

  for (const candidatePath of candidatePaths) {
    try {
      const response = await fetchWithTimeout(candidatePath, {
        cache: 'no-store',
        credentials: 'include',
        headers: defaultHeaders,
        method: 'GET',
        mode: 'same-origin',
        redirect: 'manual',
        referrer: requestReferrer || location.href,
      });

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (!response.ok) {
        if (isRedirectStatus(response.status)) {
          const redirectLocation = response.headers.get('location') || '';
          if (redirectLocation) {
            const redirectedResult = await fetchImageDataUrlFromUrl(
              redirectLocation,
              false,
            );
            if (redirectedResult) {
              return {
                contentType: redirectedResult.contentType,
                dataUrl: redirectedResult.dataUrl,
                fileId: normalizedFileId,
                ok: true,
                status: redirectedResult.status,
                url: redirectedResult.url,
              };
            }

            if (isLikelyRenderableImageUrl(redirectLocation)) {
              return {
                contentType: 'image/*',
                fileId: normalizedFileId,
                ok: true,
                status: response.status,
                url: new URL(redirectLocation, location.origin).toString(),
              };
            }
          }
        }
        continue;
      }

      if (contentType.includes('application/json')) {
        const payload = await response.json().catch(() => null);
        const directDownloadUrl = (() => {
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return '';
          }
          const record = payload;
          const directKeys = [
            'download_url',
            'downloadUrl',
            'signed_url',
            'signedUrl',
            'url',
          ];
          for (const key of directKeys) {
            const value = record?.[key];
            if (typeof value === 'string' && /^https?:\\/\\//i.test(value.trim())) {
              return value.trim();
            }
          }
          return '';
        })();

        if (directDownloadUrl) {
          const directResult = await fetchImageDataUrlFromUrl(directDownloadUrl, false);
          if (directResult) {
            return {
              contentType: directResult.contentType,
              dataUrl: directResult.dataUrl,
              fileId: normalizedFileId,
              ok: true,
              status: directResult.status,
              url: directResult.url,
            };
          }
          if (isLikelyRenderableImageUrl(directDownloadUrl)) {
            return {
              contentType: 'image/*',
              fileId: normalizedFileId,
              ok: true,
              status: response.status,
              url: directDownloadUrl,
            };
          }
        }

        const candidateUrls = collectCandidateUrlsFromJson(payload).slice(0, 8);
        for (const candidateUrl of candidateUrls) {
          const candidateResult = await fetchImageDataUrlFromUrl(candidateUrl, false);
          if (candidateResult) {
            return {
              contentType: candidateResult.contentType,
              dataUrl: candidateResult.dataUrl,
              fileId: normalizedFileId,
              ok: true,
              status: candidateResult.status,
              url: candidateResult.url,
            };
          }
        }

        const fallbackUrl = candidateUrls.find((candidateUrl) =>
          isLikelyRenderableImageUrl(candidateUrl),
        );
        if (fallbackUrl) {
          return {
            contentType: 'image/*',
            fileId: normalizedFileId,
            ok: true,
            status: response.status,
            url: fallbackUrl,
          };
        }

        continue;
      }

      if (!contentType.startsWith('image/')) {
        const dataUrl = await toDataUrl(response, contentType);
        if (
          !dataUrl ||
          !String(dataUrl).toLowerCase().startsWith('data:image/')
        ) {
          continue;
        }

        return {
          contentType: contentType || 'image/*',
          dataUrl,
          fileId: normalizedFileId,
          ok: true,
          status: response.status,
          url: response.url || candidatePath,
        };
      }

      const dataUrl = await toDataUrl(response, contentType);
      if (
        !dataUrl ||
        !String(dataUrl).toLowerCase().startsWith('data:image/')
      ) {
        continue;
      }

      return {
        contentType,
        dataUrl,
        fileId: normalizedFileId,
        ok: true,
        status: response.status,
        url: response.url || candidatePath,
      };
    } catch {
      // continue
    }
  }

  return {
    error: 'asset_fetch_failed',
    fileId: normalizedFileId,
    ok: false,
    status: 0,
  };
})()
`;

export const buildFetchImageDataUrlFromUrlScript = (
  assetUrl: string,
  replayHeaders: ReplayRequestHeaders = {},
  referrerUrl = '',
) => `
(async () => {
  const inputUrl = ${JSON.stringify(assetUrl)};
  const replayHeaders = ${JSON.stringify(replayHeaders)};
  const requestReferrer = ${JSON.stringify(referrerUrl)};
  const FETCH_TIMEOUT_MS = 30_000;
  const normalizeUrl = (value) => String(value || '').trim().split('\\\\/').join('/');
  const fetchWithTimeout = async (url, init) => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, FETCH_TIMEOUT_MS);
    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
  };
  const inferMimeTypeFromBytes = (bytes) => {
    if (!bytes || bytes.length < 4) {
      return '';
    }
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return 'image/png';
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg';
    }
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
      return 'image/gif';
    }
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
      return 'image/bmp';
    }
    if (
      bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return 'image/webp';
    }
    if (
      bytes.length >= 12 &&
      bytes[4] === 0x66 &&
      bytes[5] === 0x74 &&
      bytes[6] === 0x79 &&
      bytes[7] === 0x70
    ) {
      const brand = String.fromCharCode(bytes[8] || 0, bytes[9] || 0, bytes[10] || 0, bytes[11] || 0);
      if (brand === 'avif' || brand === 'avis') {
        return 'image/avif';
      }
    }
    return '';
  };
  const toDataUrl = async (response, preferredMimeType = '') => {
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const inferredMimeType = inferMimeTypeFromBytes(bytes);
    const mimeType =
      (preferredMimeType || '').toLowerCase().startsWith('image/')
        ? preferredMimeType
        : inferredMimeType || preferredMimeType || 'application/octet-stream';
    const blob = new Blob([bytes], { type: mimeType });
    return await new Promise((resolve, reject) => {
      try {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('file_reader_failed'));
        reader.readAsDataURL(blob);
      } catch (error) {
        reject(error);
      }
    });
  };
  const extractCandidateUrlsFromText = (value) =>
    [...new Set((String(value || '').match(/(https?:\\/\\/[^\\s"'<>]+|\\/\\/[^\\s"'<>]+|\\/backend-api\\/[^\\s"'<>]+)/gi) || []).map((entry) => normalizeUrl(entry)))];
  const collectCandidateUrlsFromJson = (value, visited = new WeakSet()) => {
    if (!value) {
      return [];
    }
    if (typeof value === 'string') {
      return extractCandidateUrlsFromText(value);
    }
    if (Array.isArray(value)) {
      return value.flatMap((entry) => collectCandidateUrlsFromJson(entry, visited));
    }
    if (typeof value !== 'object') {
      return [];
    }
    if (visited.has(value)) {
      return [];
    }
    visited.add(value);
    const record = value;
    const directUrlKeys = [
      'download_url',
      'downloadUrl',
      'signed_url',
      'signedUrl',
      'url',
      'asset_pointer_link',
      'image_url',
      'imageUrl',
    ];
    const directUrls = directUrlKeys
      .map((key) => record?.[key])
      .flatMap((entry) => (typeof entry === 'string' ? extractCandidateUrlsFromText(entry) : []));
    const nestedUrls = Object.values(record).flatMap((entry) =>
      collectCandidateUrlsFromJson(entry, visited),
    );
    return [...new Set([...directUrls, ...nestedUrls])];
  };
  const fetchDataUrl = async (candidateUrl, depth = 0) => {
    if (depth > 5) {
      return null;
    }
    const normalizedCandidateUrl = normalizeUrl(candidateUrl);
    if (!normalizedCandidateUrl) {
      return null;
    }
    try {
      const targetUrl = new URL(normalizedCandidateUrl, location.origin);
      const isSameOrigin = targetUrl.origin === location.origin;
      const response = await fetchWithTimeout(targetUrl.toString(), {
        cache: 'no-store',
        credentials: isSameOrigin ? 'include' : 'omit',
        headers: isSameOrigin
          ? {
              ...replayHeaders,
              accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            }
          : undefined,
        method: 'GET',
        mode: 'cors',
        redirect: 'follow',
        referrer: requestReferrer || location.href,
      });
      if (!response.ok) {
        return null;
      }
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('application/json') || contentType.includes('text/plain')) {
        const responseText = await response.text().catch(() => '');
        const payload = (() => {
          try {
            return JSON.parse(responseText);
          } catch {
            return null;
          }
        })();
        const nestedUrls = payload
          ? collectCandidateUrlsFromJson(payload)
          : extractCandidateUrlsFromText(responseText);
        for (const nestedUrl of nestedUrls) {
          if (!nestedUrl || nestedUrl === normalizedCandidateUrl) {
            continue;
          }
          const nestedResult = await fetchDataUrl(nestedUrl, depth + 1);
          if (nestedResult) {
            return nestedResult;
          }
        }
        return null;
      }
      const dataUrl = await toDataUrl(response, contentType);
      if (!dataUrl || !String(dataUrl).toLowerCase().startsWith('data:image/')) {
        return null;
      }
      return {
        contentType,
        dataUrl,
        status: response.status,
        url: response.url || targetUrl.toString(),
      };
    } catch {
      return null;
    }
  };
  const result = await fetchDataUrl(inputUrl, 0);
  if (result) {
    return {
      contentType: result.contentType,
      dataUrl: result.dataUrl,
      fileId: '',
      ok: true,
      status: result.status,
      url: result.url,
    };
  }
  return {
    error: 'image_data_url_fetch_failed',
    fileId: '',
    ok: false,
    status: 0,
    url: normalizeUrl(inputUrl),
  };
})()
`;

export const buildExtractConversationHtmlSnapshotScript = () => `
(() => {
  const isVisible = (element) => (
    element instanceof HTMLElement &&
    element.getBoundingClientRect().width > 0 &&
    element.getBoundingClientRect().height > 0 &&
    window.getComputedStyle(element).display !== 'none' &&
    window.getComputedStyle(element).visibility !== 'hidden' &&
    !element.hasAttribute('hidden')
  );

  const clean = (value) => (value || '')
    .replace(/\\u200b/g, '')
    .replace(/\\s+/g, ' ')
    .trim();
  const OLD_DEEP_RESEARCH_SELECTOR =
    'div.flex.max-w-full.flex-col.gap-4.grow > div';
  const isLanguageOnly = (value) => /^(mermaid|java|javascript|typescript|python|json|yaml|xml|html|sql|bash|shell|tsx|jsx|css|markdown)$/i.test(clean(value));
  const isMermaidLoadingText = (value) => new RegExp(${JSON.stringify(
    MERMAID_LOADING_TEXT_PATTERN_SOURCE,
  )}, 'i').test(clean(value));

  const escapeHtml = (value) => (value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const looksLikeDiagramSvg = (svgNode) => {
    if (!(svgNode instanceof SVGElement)) {
      return false;
    }

    const width = Number(svgNode.getAttribute('width') || '0');
    const height = Number(svgNode.getAttribute('height') || '0');
    const hasSpriteUseOnly =
      !!svgNode.querySelector('use') &&
      !svgNode.querySelector(
        'path, rect, circle, ellipse, polygon, polyline, line, text, foreignObject',
      );
    const shapeCount = svgNode.querySelectorAll(
      'path, rect, circle, ellipse, polygon, polyline, line, text, foreignObject',
    ).length;

    if (hasSpriteUseOnly) {
      return false;
    }

    if (width > 48 || height > 48) {
      return true;
    }

    return shapeCount >= 3;
  };

  const inferCodeLanguage = (element) => {
    const probes = [
      element.getAttribute('data-language') || '',
      element.className || '',
      element.getAttribute('class') || '',
      element.parentElement?.className || '',
      element.parentElement?.getAttribute('class') || '',
      element.previousElementSibling?.textContent || '',
    ]
      .filter(Boolean)
      .join(' ');

    const directMatch =
      probes.match(/language-([\\w#+.-]+)/i) ||
      probes.match(/lang(?:uage)?-([\\w#+.-]+)/i) ||
      probes.match(/\\b(mermaid|java|javascript|typescript|python|json|yaml|xml|html|sql|bash|shell|tsx|jsx|css|markdown)\\b/i);

    return directMatch?.[1]?.toLowerCase() || '';
  };

  const createCodeReplacement = (language, codeText) => {
    const replacement = document.createElement('pre');
    replacement.setAttribute('data-gptviewer-code-language', language || '');
    const codeElement = document.createElement('code');
    codeElement.innerHTML = escapeHtml(codeText || '');
    replacement.appendChild(codeElement);
    return replacement;
  };

  const normalizeContentNode = (element) => {
    const clone = element.cloneNode(true);
    if (!(clone instanceof HTMLElement)) {
      return element.outerHTML;
    }

    clone
      .querySelectorAll('button, svg, form, nav, aside, footer, [aria-hidden="true"]')
      .forEach((node) => {
        if (node instanceof SVGElement) {
          return;
        }
        node.remove();
      });

    clone.querySelectorAll('pre').forEach((preNode) => {
      if (!(preNode instanceof HTMLElement)) {
        return;
      }

      const codeNode = preNode.querySelector('code');
      const rawCodeText = (codeNode?.textContent || preNode.textContent || '').replace(/\\u200b/g, '');
      const language = inferCodeLanguage(codeNode instanceof HTMLElement ? codeNode : preNode);
      const svgNode = preNode.querySelector('svg');
      const hasMeaningfulCode =
        clean(rawCodeText) &&
        !isLanguageOnly(rawCodeText) &&
        !isMermaidLoadingText(rawCodeText);

      if (hasMeaningfulCode) {
        preNode.replaceWith(createCodeReplacement(language, rawCodeText));
        return;
      }

      if (svgNode instanceof SVGElement && looksLikeDiagramSvg(svgNode)) {
        preNode.replaceWith(createCodeReplacement(language || 'svg', svgNode.outerHTML));
        return;
      }

      if (isMermaidLoadingText(rawCodeText)) {
        preNode.remove();
      }
    });

    clone.querySelectorAll('svg').forEach((svgNode) => {
      if (!(svgNode instanceof SVGElement)) {
        return;
      }

      if (svgNode.closest('pre')) {
        return;
      }

      const previousElement = svgNode.previousElementSibling;
      const previousText = clean(previousElement?.textContent || '');
      if (isLanguageOnly(previousText)) {
        previousElement?.remove();
      }

      if (!looksLikeDiagramSvg(svgNode)) {
        return;
      }

      svgNode.replaceWith(createCodeReplacement(previousText === 'mermaid' ? 'svg' : 'svg', svgNode.outerHTML));
    });

    return clone.outerHTML;
  };

  const scoreHtml = (html) => clean(html).length;

  const getBestDocumentContentHtml = (doc, depth = 0) => {
    if (!doc || depth > 6) {
      return '';
    }

    const ownCandidates = [
      ...Array.from(doc.querySelectorAll(OLD_DEEP_RESEARCH_SELECTOR)),
      doc.querySelector('[data-message-content]'),
      doc.querySelector('[data-testid*="message-content"]'),
      doc.querySelector('.markdown'),
      doc.querySelector('.prose'),
      doc.querySelector('[class*="markdown"]'),
      doc.querySelector('[class*="prose"]'),
      doc.querySelector('main'),
      doc.querySelector('article'),
      doc.body,
    ].filter((candidate, index, array) =>
      candidate instanceof HTMLElement && array.indexOf(candidate) === index,
    );

    let bestOwnHtml = '';
    ownCandidates.forEach((candidate) => {
      if (!(candidate instanceof HTMLElement)) {
        return;
      }

      const html = normalizeContentNode(candidate);
      if (scoreHtml(html) > scoreHtml(bestOwnHtml)) {
        bestOwnHtml = html;
      }
    });

    let bestNestedHtml = '';
    Array.from(doc.querySelectorAll('iframe')).forEach((iframeNode) => {
      if (!(iframeNode instanceof HTMLIFrameElement)) {
        return;
      }

      try {
        const nestedDocument = iframeNode.contentDocument;
        const nestedHtml = getBestDocumentContentHtml(nestedDocument, depth + 1);
        if (scoreHtml(nestedHtml) > scoreHtml(bestNestedHtml)) {
          bestNestedHtml = nestedHtml;
        }
      } catch {
        // ignore cross-origin or unavailable iframe access
      }
    });

    return scoreHtml(bestNestedHtml) > scoreHtml(bestOwnHtml)
      ? bestNestedHtml
      : bestOwnHtml;
  };

  const getContentHtml = (element) => {
    const deepResearchIframeSrc = getDeepResearchIframeSrc(element);
    const wholeElementHtml = normalizeContentNode(element);

    const iframeNodes = Array.from(element.querySelectorAll('iframe')).filter(
      (node) => node instanceof HTMLIFrameElement,
    );
    if (iframeNodes.length > 0) {
      const iframeHtmlParts = iframeNodes.flatMap((iframeNode) => {
        if (!(iframeNode instanceof HTMLIFrameElement)) {
          return [];
        }

        try {
          const iframeDocument = iframeNode.contentDocument;
          const iframeHtml = getBestDocumentContentHtml(iframeDocument);
          if (!scoreHtml(iframeHtml)) {
            return [];
          }

          return [iframeHtml];
        } catch {
          return [];
        }
      });

      if (iframeHtmlParts.length > 0) {
        return iframeHtmlParts.join('\\n');
      }

      if (scoreHtml(wholeElementHtml) > 0) {
        return wholeElementHtml;
      }
    }

    const deepResearchCandidates = Array.from(
      element.querySelectorAll(OLD_DEEP_RESEARCH_SELECTOR),
    ).filter((candidate) => candidate instanceof HTMLElement && isVisible(candidate));
    if (deepResearchCandidates.length > 0 || deepResearchIframeSrc) {
      const candidateHtmlValues = deepResearchCandidates
        .filter((candidate) => candidate instanceof HTMLElement)
        .map((candidate) => normalizeContentNode(candidate))
        .filter((html) => scoreHtml(html) > 0);

      candidateHtmlValues.push(wholeElementHtml);
      candidateHtmlValues.sort((left, right) => scoreHtml(right) - scoreHtml(left));

      const bestCandidateHtml = candidateHtmlValues[0] || '';
      if (scoreHtml(bestCandidateHtml) > 0) {
        return bestCandidateHtml;
      }
    }

    const candidates = [
      '[data-message-content]',
      '[data-testid*="message-content"]',
      '.markdown',
      '.prose',
      '[class*="markdown"]',
      '[class*="prose"]',
    ];

    for (const selector of candidates) {
      const candidate = element.querySelector(selector);
      if (candidate instanceof HTMLElement && isVisible(candidate)) {
        return normalizeContentNode(candidate);
      }
    }

    return wholeElementHtml;
  };

  const getDeepResearchIframeSrc = (element) => {
    const iframeCandidates = [
      ...Array.from(
        element.querySelectorAll(
          'iframe[title="internal://deep-research"], iframe[src*="connector_openai_deep_research"]',
        ),
      ),
      ...Array.from(element.querySelectorAll('iframe')),
    ].filter((node, index, array) => array.indexOf(node) === index);

    for (const iframe of iframeCandidates) {
      if (!(iframe instanceof HTMLIFrameElement)) {
        continue;
      }

      const src = clean(iframe.getAttribute('src') || iframe.src || '');
      if (src.includes('connector_openai_deep_research')) {
        return src;
      }

      try {
        const nestedDocument = iframe.contentDocument;
        const nestedIframe = nestedDocument?.querySelector(
          'iframe[title="internal://deep-research"], iframe[src*="connector_openai_deep_research"]',
        );
        if (nestedIframe instanceof HTMLIFrameElement) {
          const nestedSrc = clean(
            nestedIframe.getAttribute('src') || nestedIframe.src || '',
          );
          if (nestedSrc.includes('connector_openai_deep_research')) {
            return nestedSrc;
          }
        }
      } catch {
        // ignore cross-origin or unavailable iframe access
      }
    }

    return '';
  };

  const inferRole = (element, index) => {
    const explicitRole = element.getAttribute('data-message-author-role') ||
      element.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role');
    if (explicitRole === 'user' || explicitRole === 'assistant') {
      return explicitRole;
    }

    const className = [element.className, element.parentElement?.className]
      .filter((value) => typeof value === 'string')
      .join(' ')
      .toLowerCase();
    if (/justify-end|items-end|ml-auto|self-end/.test(className)) {
      return 'user';
    }
    if (/assistant|ai/.test(className)) {
      return 'assistant';
    }

    return index % 2 === 0 ? 'user' : 'assistant';
  };

  const main = document.querySelector('main') || document.body;
  const normalizeNode = (node) => (
    node.closest('article, [data-testid*="message"], [data-testid*="conversation-turn"]') || node
  );
  const explicitNodes = Array.from(main.querySelectorAll('[data-message-author-role]'))
    .map((node) => normalizeNode(node))
    .filter((node, index, array) => isVisible(node) && array.indexOf(node) === index);
  const fallbackNodes = Array.from(
    main.querySelectorAll('article, [data-testid*="message"], [data-testid*="conversation-turn"]'),
  ).filter((node, index, array) => isVisible(node) && array.indexOf(node) === index);
  const nodes = explicitNodes.length > 0 ? explicitNodes : fallbackNodes;

  const blocks = nodes
    .map((node, index) => ({
      deepResearchIframeSrc: getDeepResearchIframeSrc(node) || undefined,
      html: getContentHtml(node),
      role: inferRole(node, index),
    }))
    .filter((block) => clean(block.html).length > 0 || !!block.deepResearchIframeSrc);

  return {
    blocks,
    conversationHtml: main.outerHTML,
    currentUrl: window.location.href,
    title: clean(
      document.querySelector('main h1, header h1, h1')?.textContent ||
      document.title.replace(/\\s*[-|]\\s*ChatGPT.*$/i, ''),
    ) || 'ChatGPT 대화',
  };
})()
`;

export const buildActivateDeepResearchEmbedsScript = () => `
(() => {
  const selectors = [
    'iframe[title="internal://deep-research"]',
    'iframe[src*="connector_openai_deep_research"]',
  ];

  const iframes = selectors.flatMap((selector) =>
    Array.from(document.querySelectorAll(selector)),
  ).filter((node, index, array) =>
    node instanceof HTMLIFrameElement && array.indexOf(node) === index,
  );

  let activated = 0;

  iframes.forEach((iframe) => {
    if (!(iframe instanceof HTMLIFrameElement)) {
      return;
    }

    try {
      iframe.setAttribute('loading', 'eager');
      iframe.setAttribute('fetchpriority', 'high');
      iframe.scrollIntoView({ block: 'center', inline: 'nearest' });
      iframe.closest('article, [data-testid*="message"], [data-testid*="conversation-turn"]')
        ?.scrollIntoView({ block: 'center', inline: 'nearest' });
      activated += 1;
    } catch {
      // ignore activation failures
    }
  });

  return { activated };
})()
`;

export const buildExtractStandaloneHtmlSnapshotScript = () => `
(() => {
  const clean = (value) => (value || '')
    .replace(/\\u200b/g, '')
    .replace(/\\s+/g, ' ')
    .trim();

  const selectRoot = (doc) =>
    doc.querySelector('main') ||
    doc.querySelector('article') ||
    doc.body;

  const toPreview = (html) => clean(html).slice(0, 240);

  const snapshotDocument = (doc, currentDepth = 0) => {
    const root = selectRoot(doc);
    const documentHtml = doc.documentElement?.outerHTML || '';
    const rootHtml = root instanceof HTMLElement ? root.outerHTML : '';
    const effectiveHtml =
      rootHtml.length >= documentHtml.length * 0.2 ? rootHtml : documentHtml;
    const nestedIframes = Array.from(
      doc.querySelectorAll('iframe'),
    ).filter((node) => node instanceof HTMLIFrameElement);
    const iframeSrcs = nestedIframes
      .map((node) => clean(node.getAttribute('src') || node.src || ''))
      .filter(Boolean)
      .slice(0, 16);

    let bestNested = null;
    nestedIframes.forEach((iframeNode) => {
      if (!(iframeNode instanceof HTMLIFrameElement)) {
        return;
      }

      try {
        const nestedDocument = iframeNode.contentDocument;
        if (!nestedDocument || currentDepth > 6) {
          return;
        }

        const nestedSnapshot = snapshotDocument(nestedDocument, currentDepth + 1);
        if (!nestedSnapshot || !nestedSnapshot.html) {
          return;
        }

        if (!bestNested || nestedSnapshot.html.length > bestNested.html.length) {
          bestNested = nestedSnapshot;
        }
      } catch {
        // ignore cross-origin or unavailable iframe access
      }
    });

    if (bestNested) {
      return bestNested;
    }

    return {
      allIframeCount: nestedIframes.length,
      currentUrl: doc.defaultView?.location?.href || window.location.href,
      html: effectiveHtml,
      htmlPreview: toPreview(effectiveHtml),
      iframeCount: nestedIframes.length,
      iframeSrcs,
      maxIframeDepth: currentDepth,
      title: clean(
        doc.querySelector('main h1, article h1, header h1, h1')?.textContent ||
        doc.title.replace(/\\s*[-|]\\s*ChatGPT.*$/i, ''),
      ) || 'ChatGPT 대화',
    };
  };

  const snapshot = snapshotDocument(document);

  return {
    allIframeCount: snapshot?.allIframeCount ?? 0,
    currentUrl: snapshot?.currentUrl || window.location.href,
    html: snapshot?.html || document.documentElement?.outerHTML || document.body?.outerHTML || '',
    htmlPreview: snapshot?.htmlPreview || toPreview(document.documentElement?.outerHTML || document.body?.outerHTML || ''),
    iframeCount: snapshot?.iframeCount ?? 0,
    iframeSrcs: snapshot?.iframeSrcs || [],
    maxIframeDepth: snapshot?.maxIframeDepth ?? 0,
    title: snapshot?.title || 'ChatGPT 대화',
  };
})()
`;

export type {
  ExtractedConversationHtmlBlock,
  ExtractedStandaloneHtmlSnapshot,
  FetchedConversationAssetPayload,
  FetchedConversationJsonPayload,
  ExtractedConversationHtmlReadiness,
  ExtractedConversationHtmlSnapshot,
};
