import type {
  SharedConversationImport,
  SharedConversationMessage,
  SharedConversationSource,
} from '../../shared/refresh/sharedConversationRefresh';
import type { ExtractedConversationHtmlSnapshot } from '../services/sharedConversationRefresh/chatgpt/chatGptConversationImportScripts';
import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeRemark from 'rehype-remark';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';

const TITLE_SUFFIX_PATTERN = /\s*[-|]\s*ChatGPT.*$/i;
const CODE_BLOCK_TOKEN_PREFIX = 'GPTVIEWERCODEBLOCKTOKEN';
const CODE_BLOCK_TOKEN_SUFFIX = 'END';
const MERMAID_LOADING_TEXT_PATTERN =
  /^(?:mermaid\s*)?(?:다이어그램\s*)?불러오는 중(?:\.{3}|…)?$/i;
const HTTP_HEADER_CODE_PATTERN = /^https?:\/\/|^httphttp\/1\.[01]\s+\d{3}|^http\/1\.[01]\s+\d{3}/i;
const LANGUAGE_ONLY_CODE_PATTERN =
  /^(mermaid|java|javascript|typescript|python|json|yaml|xml|html|sql|bash|shell|tsx|jsx|css|markdown)$/i;

const decodeHtml = (value: string): string =>
  value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\\d+);/g, (_, decimal) =>
      String.fromCodePoint(Number(decimal)),
    );

const normalizeText = (value: string): string =>
  decodeHtml(value)
    .replace(/\u200b/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();

const extractStructuredText = (value: string): string =>
  decodeHtml(value)
    .replace(/\u200b/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|blockquote|section|article|pre|code)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

const isLanguageOnlyCodeText = (value: string): boolean =>
  LANGUAGE_ONLY_CODE_PATTERN.test(normalizeText(value));

const looksLikeMermaidSource = (value: string): boolean => {
  const normalizedValue = value.trim();
  if (!normalizedValue || MERMAID_LOADING_TEXT_PATTERN.test(normalizedValue)) {
    return false;
  }

  return (
    /(^|\n)\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|xychart-beta|xychart|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|requirementDiagram|block-beta|architecture-beta)\b/.test(
      normalizedValue,
    ) ||
    normalizedValue.includes('-->') ||
    normalizedValue.includes('subgraph')
  );
};

const looksLikeDiagramSvg = (value: string): boolean => {
  const svgMatch = value.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/i);
  if (!svgMatch) {
    return false;
  }

  const attributes = svgMatch[1] ?? '';
  const content = svgMatch[2] ?? '';
  const width = Number(attributes.match(/\bwidth="(\d+(?:\.\d+)?)"/i)?.[1] ?? '0');
  const height = Number(attributes.match(/\bheight="(\d+(?:\.\d+)?)"/i)?.[1] ?? '0');
  const hasSpriteUseOnly =
    /<use\b/i.test(content) &&
    !/(<path\b|<rect\b|<circle\b|<ellipse\b|<polygon\b|<polyline\b|<line\b|<text\b|<foreignObject\b)/i.test(
      content,
    );
  const shapeCount =
    (content.match(/<(path|rect|circle|ellipse|polygon|polyline|line|text|foreignObject)\b/gi)
      ?.length ?? 0);

  if (hasSpriteUseOnly) {
    return false;
  }

  if (width > 48 || height > 48) {
    return true;
  }

  return shapeCount >= 3;
};

const extractCodeText = (value: string): string => {
  const normalizedValue = value.trim();
  const codeMatch = normalizedValue.match(/<code\b[^>]*>([\s\S]*?)<\/code>/i);
  const codeInnerValue = codeMatch?.[1] ?? normalizedValue;
  const svgMatch =
    codeInnerValue.match(/&lt;svg[\s\S]*?&lt;\/svg&gt;/i) ??
    codeInnerValue.match(/<svg[\s\S]*?<\/svg>/i);

  if (svgMatch?.[0] && looksLikeDiagramSvg(decodeHtml(svgMatch[0]))) {
    return decodeHtml(svgMatch[0]).trim();
  }

  return normalizeText(
    decodeHtml(codeInnerValue)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p|li|blockquote|section|article)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  );
};

const extractFallbackCodeText = (
  value: string,
  language: string,
): string => {
  const structuredText = extractStructuredText(value);
  if (!structuredText) {
    return '';
  }

  if (language === 'mermaid') {
    return looksLikeMermaidSource(structuredText) ? structuredText : '';
  }

  return isLanguageOnlyCodeText(structuredText) ? '' : structuredText;
};

const cleanHtmlForMarkdown = (value: string): string =>
  value
    .replace(/<(script|style|svg|button|form|nav|aside|footer)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<([a-z0-9-]+)[^>]*(aria-hidden|hidden)="true"[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<span[^>]*class="[^"]*katex[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '')
    .replace(/<div[^>]*data-testid="[^"]*copy[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<button[^>]*aria-label="[^"]*(Copy|복사)[^"]*"[^>]*>[\s\S]*?<\/button>/gi, '');

const inferCodeLanguage = (value: string): string => {
  const directMatch =
    value.match(/data-gptviewer-code-language="([\w#+.-]+)"/i) ??
    value.match(/language-([\w#+.-]+)/i) ??
    value.match(/data-language="([\w#+.-]+)"/i) ??
    value.match(/lang(?:uage)?-([\w#+.-]+)/i);
  if (directMatch?.[1]) {
    return directMatch[1].toLowerCase();
  }

  const labelBeforePreMatch = value.match(
    />(mermaid|java|javascript|typescript|python|json|yaml|xml|html|sql|bash|shell|tsx|jsx|css|markdown)</i,
  );
  if (labelBeforePreMatch?.[1]) {
    return labelBeforePreMatch[1].toLowerCase();
  }

  return '';
};

const extractCodeBlocks = (value: string) => {
  const codeBlocks: string[] = [];
  const htmlWithoutCodeBlocks = value.replace(
    /<pre\b[^>]*>([\s\S]*?)<\/pre>/gi,
    (match, innerHtml) => {
      let codeLanguage = inferCodeLanguage(match);
      let codeText = extractCodeText(innerHtml);
      if (isLanguageOnlyCodeText(codeText)) {
        codeText = extractFallbackCodeText(match, codeLanguage);
      }

      if (!codeText) {
        const svgMatch =
          match.match(/<svg[\s\S]*?<\/svg>/i) ??
          innerHtml.match(/<svg[\s\S]*?<\/svg>/i);
        if (svgMatch?.[0] && looksLikeDiagramSvg(decodeHtml(svgMatch[0]))) {
          codeLanguage = 'svg';
          codeText = decodeHtml(svgMatch[0]).trim();
        }
      }

      if (
        !codeText ||
        isLanguageOnlyCodeText(codeText) ||
        MERMAID_LOADING_TEXT_PATTERN.test(codeText) ||
        (codeLanguage === 'mermaid' && HTTP_HEADER_CODE_PATTERN.test(codeText))
      ) {
        return '';
      }
      const codeFence = `\n\`\`\`${codeLanguage}\n${codeText}\n\`\`\`\n`;
      const token = `${CODE_BLOCK_TOKEN_PREFIX}${codeBlocks.length}${CODE_BLOCK_TOKEN_SUFFIX}`;
      codeBlocks.push(codeFence);
      return `<p>${token}</p>`;
    },
  );

  return {
    codeBlocks,
    htmlWithoutCodeBlocks,
  };
};

const convertHtmlToMarkdown = (value: string): string => {
  const cleanedHtml = cleanHtmlForMarkdown(value);
  const { codeBlocks, htmlWithoutCodeBlocks } = extractCodeBlocks(cleanedHtml);

  let markdown = String(
    unified()
      .use(rehypeParse, { fragment: true })
      .use(rehypeRemark)
      .use(remarkGfm)
      .use(remarkStringify, {
        bullet: '-',
        fences: true,
        listItemIndent: 'one',
      })
      .processSync(htmlWithoutCodeBlocks),
  );

  codeBlocks.forEach((codeBlock, index) => {
    const tokenPattern = new RegExp(
      `(?:${CODE_BLOCK_TOKEN_PREFIX}|GPTVIEWER\\\\?_CODE\\\\?_BLOCK\\\\?_?)${index}(?:${CODE_BLOCK_TOKEN_SUFFIX})?`,
      'g',
    );
    markdown = markdown.replace(tokenPattern, codeBlock.trim());
  });

  if (!markdown.trim() && codeBlocks.length > 0) {
    markdown = codeBlocks.join('\n\n');
  }

  return normalizeText(markdown);
};

const extractTitleFromHtml = (value: string): string => {
  const headingMatch =
    value.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ??
    value.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) ??
    value.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!headingMatch) {
    return '';
  }
  return convertHtmlToMarkdown(headingMatch[1]);
};

const normalizeTitle = (value: string): string =>
  value.replace(TITLE_SUFFIX_PATTERN, '').trim() || 'ChatGPT 대화';

const getSnapshotBlocks = (
  snapshot: ExtractedConversationHtmlSnapshot,
): ExtractedConversationHtmlSnapshot['blocks'] =>
  snapshot.blocks.filter((block) => !!block.html.trim());

const inferRoleFromHtml = (
  value: string,
  index: number,
): 'assistant' | 'user' => {
  const explicitRoleMatch = value.match(
    /data-message-author-role="(assistant|user)"/i,
  );
  if (explicitRoleMatch?.[1] === 'assistant' || explicitRoleMatch?.[1] === 'user') {
    return explicitRoleMatch[1];
  }

  if (/justify-end|items-end|ml-auto|self-end/i.test(value)) {
    return 'user';
  }

  if (/assistant|ai-response|assistant-turn/i.test(value)) {
    return 'assistant';
  }

  return index % 2 === 0 ? 'user' : 'assistant';
};

const extractConversationHtmlContainer = (value: string): string =>
  value.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ??
  value.match(/<body\b[\s\S]*?<\/body>/i)?.[0] ??
  value;

const extractConversationBlocksFromDocumentHtml = (
  value: string,
): ExtractedConversationHtmlSnapshot['blocks'] => {
  const containerHtml = extractConversationHtmlContainer(value);
  const articleBlocks = [...containerHtml.matchAll(/<article\b[\s\S]*?<\/article>/gi)].map(
    (match) => match[0],
  );

  const blocks = articleBlocks.map((html, index) => ({
    html,
    role: inferRoleFromHtml(html, index),
  }));

  return blocks.filter((block) => !!convertHtmlToMarkdown(block.html));
};

export const parseChatGptConversationHtmlSnapshot = (
  snapshot: ExtractedConversationHtmlSnapshot,
  fallbackUrl: string,
): Omit<SharedConversationImport, 'fetchedAt' | 'refreshRequest'> | null => {
  const blocks = getSnapshotBlocks(snapshot);
  const messages = blocks
    .map((block) => ({
      role: block.role,
      sources: [] as SharedConversationSource[],
      text: convertHtmlToMarkdown(block.html),
    }))
    .filter(
      (message): message is SharedConversationMessage =>
        !!message.text && (message.role === 'assistant' || message.role === 'user'),
    );

  if (messages.length === 0) {
    return null;
  }

  const summarySource =
    messages.find((message) => message.role === 'assistant')?.text ??
    messages[0]?.text ??
    '';
  const rawTitle = snapshot.title.trim();
  const htmlTitle = extractTitleFromHtml(snapshot.conversationHtml);
  const derivedTitle = normalizeTitle(rawTitle || htmlTitle);

  return {
    messages,
    sourceUrl: fallbackUrl,
    summary: summarySource.replace(/\n/g, ' ').slice(0, 80),
    title: derivedTitle,
  };
};

export const parseChatGptConversationDocumentHtml = (
  documentHtml: string,
  fallbackUrl: string,
): Omit<SharedConversationImport, 'fetchedAt' | 'refreshRequest'> | null => {
  const conversationHtml = extractConversationHtmlContainer(documentHtml);
  const blocks = extractConversationBlocksFromDocumentHtml(documentHtml);

  if (blocks.length === 0) {
    return null;
  }

  return parseChatGptConversationHtmlSnapshot(
    {
      blocks,
      conversationHtml,
      currentUrl: fallbackUrl,
      title: extractTitleFromHtml(documentHtml),
    },
    fallbackUrl,
  );
};

export const parseChatGptStandaloneHtml = (
  documentHtml: string,
  fallbackUrl: string,
): Omit<SharedConversationImport, 'fetchedAt' | 'refreshRequest'> | null => {
  const parsedConversation = parseChatGptConversationDocumentHtml(
    documentHtml,
    fallbackUrl,
  );
  if (parsedConversation) {
    return parsedConversation;
  }

  const conversationHtml = extractConversationHtmlContainer(documentHtml);
  const text = convertHtmlToMarkdown(conversationHtml);
  if (!text) {
    return null;
  }

  const title = normalizeTitle(extractTitleFromHtml(documentHtml) || 'ChatGPT 대화');

  return {
    messages: [
      {
        role: 'assistant',
        sources: [],
        text,
      },
    ],
    sourceUrl: fallbackUrl,
    summary: text.replace(/\n/g, ' ').slice(0, 80),
    title,
  };
};
