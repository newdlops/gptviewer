"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildExtractStandaloneHtmlSnapshotScript = exports.buildActivateDeepResearchEmbedsScript = exports.buildExtractConversationHtmlSnapshotScript = exports.buildFetchConversationAssetDataUrlScript = exports.buildFetchConversationJsonScript = exports.buildInspectConversationHtmlReadinessScript = exports.buildPrepareConversationHtmlSnapshotScript = void 0;
const MERMAID_LOADING_TEXT_PATTERN_SOURCE = '^(?:mermaid\\\\s*)?(?:다이어그램\\\\s*)?불러오는 중(?:\\\\.{3}|…)?$';
const buildPrepareConversationHtmlSnapshotScript = () => `
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
exports.buildPrepareConversationHtmlSnapshotScript = buildPrepareConversationHtmlSnapshotScript;
const buildInspectConversationHtmlReadinessScript = () => `
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
exports.buildInspectConversationHtmlReadinessScript = buildInspectConversationHtmlReadinessScript;
const buildFetchConversationJsonScript = (conversationId, replayHeaders = {}) => `
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
exports.buildFetchConversationJsonScript = buildFetchConversationJsonScript;
const buildFetchConversationAssetDataUrlScript = (fileId, replayHeaders = {}) => `
(async () => {
  const inputFileId = ${JSON.stringify(fileId)};
  const replayHeaders = ${JSON.stringify(replayHeaders)};
  const normalizedFileId = String(inputFileId)
    .trim()
    .replace(/^sediment:\\/\\//i, '');

  const toDataUrl = async (response) => {
    const blob = await response.blob();
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
    accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    ...replayHeaders,
  };

  const candidatePaths = [
    '/backend-api/files/' + normalizedFileId + '/download',
    '/backend-api/files/' + normalizedFileId,
    '/backend-api/files/' + normalizedFileId + '?download=true',
    '/backend-api/files/' + normalizedFileId + '/content',
  ];

  for (const candidatePath of candidatePaths) {
    try {
      const response = await fetch(candidatePath, {
        cache: 'no-store',
        credentials: 'include',
        headers: defaultHeaders,
        method: 'GET',
        mode: 'same-origin',
        redirect: 'follow',
        referrer: location.href,
      });

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (!response.ok) {
        continue;
      }

      if (contentType.includes('application/json')) {
        const payload = await response.json().catch(() => null);
        const candidateUrls = collectCandidateUrlsFromJson(payload);
        for (const candidateUrl of candidateUrls) {
          try {
            const imageResponse = await fetch(candidateUrl, {
              cache: 'no-store',
              credentials: 'omit',
              method: 'GET',
              mode: 'cors',
              redirect: 'follow',
            });
            if (!imageResponse.ok) {
              continue;
            }

            const imageContentType = (
              imageResponse.headers.get('content-type') || ''
            ).toLowerCase();
            if (!imageContentType.startsWith('image/')) {
              continue;
            }

            const dataUrl = await toDataUrl(imageResponse);
            if (!dataUrl) {
              continue;
            }

            return {
              contentType: imageContentType,
              dataUrl,
              fileId: normalizedFileId,
              ok: true,
              status: imageResponse.status,
              url: candidateUrl,
            };
          } catch {
            // continue
          }
        }

        continue;
      }

      if (!contentType.startsWith('image/')) {
        continue;
      }

      const dataUrl = await toDataUrl(response);
      if (!dataUrl) {
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
exports.buildFetchConversationAssetDataUrlScript = buildFetchConversationAssetDataUrlScript;
const buildExtractConversationHtmlSnapshotScript = () => `
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
  const isMermaidLoadingText = (value) => new RegExp(${JSON.stringify(MERMAID_LOADING_TEXT_PATTERN_SOURCE)}, 'i').test(clean(value));

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
exports.buildExtractConversationHtmlSnapshotScript = buildExtractConversationHtmlSnapshotScript;
const buildActivateDeepResearchEmbedsScript = () => `
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
exports.buildActivateDeepResearchEmbedsScript = buildActivateDeepResearchEmbedsScript;
const buildExtractStandaloneHtmlSnapshotScript = () => `
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
exports.buildExtractStandaloneHtmlSnapshotScript = buildExtractStandaloneHtmlSnapshotScript;
