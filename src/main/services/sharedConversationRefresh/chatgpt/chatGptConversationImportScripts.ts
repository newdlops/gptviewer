type ExtractedConversationHtmlBlock = {
  html: string;
  role: 'assistant' | 'user';
};

type ExtractedConversationHtmlSnapshot = {
  blocks: ExtractedConversationHtmlBlock[];
  conversationHtml: string;
  currentUrl: string;
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

  const getContentHtml = (element) => {
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

    return normalizeContentNode(element);
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
      html: getContentHtml(node),
      role: inferRole(node, index),
    }))
    .filter((block) => clean(block.html).length > 0);

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

export type {
  ExtractedConversationHtmlBlock,
  FetchedConversationJsonPayload,
  ExtractedConversationHtmlReadiness,
  ExtractedConversationHtmlSnapshot,
};
