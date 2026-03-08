import type {
  SharedConversationImport,
  SharedConversationMessage,
} from '../../shared/refresh/sharedConversationRefresh';
import type { ChatGptConversationNetworkRecord } from '../services/sharedConversationRefresh/chatgpt/chatGptConversationNetworkMonitor';
import { parseChatGptConversationDocumentHtml } from './chatGptConversationHtmlParser';

const CITATION_TOKEN_PATTERN = /\uE200(?:cite|filecite|navlist)\uE202[\s\S]*?\uE201/g;
const INLINE_CITATION_TOKEN_PATTERN =
  /\uE200(filecite|cite|navlist)\uE202([^\uE202\uE201]+)(?:\uE202([^\uE201]+))?\uE201/g;

type ConversationMappingNode = {
  message?: {
    author?: { role?: string };
    content?: {
      content_type?: string;
      parts?: unknown[];
    };
    metadata?: Record<string, unknown>;
    status?: string;
  };
  parent?: string | null;
};

type MappingConversation = {
  current_node?: string;
  mapping?: Record<string, ConversationMappingNode>;
  title?: string;
};

type ConversationCandidate = Omit<
  SharedConversationImport,
  'fetchedAt' | 'refreshRequest'
>;

type RecordConversationCandidate = {
  conversation: ConversationCandidate;
  parser: 'json' | 'rsc' | 'html';
  record: ChatGptConversationNetworkRecord;
  score: number;
};

const MERMAID_SOURCE_PATTERN =
  /(^|\n)\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|xychart-beta|xychart|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|requirementDiagram|block-beta|architecture-beta)\b|-->|\bsubgraph\b/;
const LANGUAGE_FENCE_PATTERN = /```([\w#+.-]+)?\n[\s\S]*?```/g;
const LANGUAGE_ONLY_PATTERN =
  /^(mermaid|java|javascript|typescript|python|json|yaml|xml|html|sql|bash|shell|tsx|jsx|css|markdown|svg)$/i;
const MERMAID_LOADING_TEXT_PATTERN =
  /^(?:mermaid\s*)?(?:다이어그램\s*)?불러오는 중(?:\.{3}|…)?$/i;
const HTTP_HEADER_CODE_PATTERN =
  /^https?:\/\/|^httphttp\/1\.[01]\s+\d{3}|^http\/1\.[01]\s+\d{3}/i;

const decodeRscPayload = (value: string): string => JSON.parse(`"${value}"`);

const sanitizeConversationTitle = (title: string): string =>
  title
    .replace(/^ChatGPT\s*-\s*/i, '')
    .replace(/\s*[|-]\s*ChatGPT$/i, '')
    .replace(/\s+[|·-]\s+OpenAI$/i, '')
    .trim() || 'ChatGPT 대화';

const normalizeMessageText = (value: string): string =>
  value
    .replace(
      INLINE_CITATION_TOKEN_PATTERN,
      (_match, citationType: string) =>
        citationType === 'filecite' ? '[파일 참조]' : ' ',
    )
    .replace(CITATION_TOKEN_PATTERN, '')
    .replace(/\r/g, '')
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

const normalizeCodeLanguage = (value: string): string =>
  value.trim().toLowerCase().replace(/^language[-:_]?/i, '');

const inferObjectLanguage = (record: Record<string, unknown>): string => {
  const directCandidates = [
    record.language,
    record.lang,
    record.syntax,
    record.format,
    record.mime_type,
    record.mimeType,
    record.file_type,
    record.fileType,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return normalizeCodeLanguage(candidate);
    }
  }

  const metadata = record.metadata;
  if (metadata && typeof metadata === 'object') {
    const metadataRecord = metadata as Record<string, unknown>;
    const nestedLanguage = inferObjectLanguage(metadataRecord);
    if (nestedLanguage) {
      return nestedLanguage;
    }
  }

  return '';
};

const looksLikeCodeBlock = (value: string): boolean => {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return false;
  }

  return (
    normalizedValue.includes('\n') ||
    /[{};<>]/.test(normalizedValue) ||
    normalizedValue.includes('=>') ||
    normalizedValue.includes('def ') ||
    normalizedValue.includes('class ') ||
    normalizedValue.includes('function ') ||
    normalizedValue.includes('import ') ||
    normalizedValue.includes('SELECT ') ||
    normalizedValue.includes('<?xml')
  );
};

const shouldRenderAsCodeBlock = (
  value: string,
  language: string,
  contentType: string,
): boolean => {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return false;
  }

  if (normalizedValue.startsWith('```')) {
    return false;
  }

  if (language === 'mermaid') {
    return MERMAID_SOURCE_PATTERN.test(normalizedValue);
  }

  if (language && !LANGUAGE_ONLY_PATTERN.test(normalizedValue)) {
    return true;
  }

  return /code|source|snippet|svg|diagram/i.test(contentType) && looksLikeCodeBlock(normalizedValue);
};

const wrapCodeFence = (value: string, language: string): string => {
  const normalizedValue = value.trim();
  const normalizedLanguage = normalizeCodeLanguage(language);
  return `\`\`\`${normalizedLanguage}\n${normalizedValue}\n\`\`\``;
};

const collectRecordStrings = (
  record: Record<string, unknown>,
  keys: string[],
): string[] =>
  keys.flatMap((key) => {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return [value];
    }
    if (Array.isArray(value)) {
      return value.filter(
        (entry): entry is string => typeof entry === 'string' && !!entry.trim(),
      );
    }
    return [];
  });

const collectStringLeaves = (
  value: unknown,
  visited = new WeakSet<object>(),
): string[] => {
  if (typeof value === 'string') {
    return value.trim() ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectStringLeaves(entry, visited));
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  if (visited.has(value)) {
    return [];
  }
  visited.add(value);

  return Object.values(value as Record<string, unknown>).flatMap((entry) =>
    collectStringLeaves(entry, visited),
  );
};

const chooseBestCodeCandidate = (
  candidates: string[],
  language: string,
  contentType: string,
): string => {
  const sanitizedCandidates = candidates
    .map((candidate) => candidate.trim())
    .filter(
      (candidate) =>
        !!candidate &&
        !LANGUAGE_ONLY_PATTERN.test(candidate) &&
        !MERMAID_LOADING_TEXT_PATTERN.test(candidate) &&
        !HTTP_HEADER_CODE_PATTERN.test(candidate),
    );

  if (language === 'mermaid') {
    return (
      sanitizedCandidates.find((candidate) => MERMAID_SOURCE_PATTERN.test(candidate)) ??
      ''
    );
  }

  return (
    sanitizedCandidates.find((candidate) =>
      shouldRenderAsCodeBlock(candidate, language, contentType),
    ) ??
    sanitizedCandidates.sort((left, right) => right.length - left.length)[0] ??
    ''
  );
};

const renderConversationPart = (value: unknown): string[] => {
  if (typeof value === 'string') {
    return value.trim() ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => renderConversationPart(entry));
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  const contentType = String(record.content_type ?? record.type ?? record.kind ?? '');
  const language = inferObjectLanguage(record);
  const primaryCodeCandidates = collectRecordStrings(record, [
    'code',
    'source',
    'source_text',
    'sourceText',
    'raw_code',
    'rawCode',
    'markdown',
    'html',
    'value',
    'text',
  ]);

  const deepLeafCandidates =
    language || /code|source|snippet|svg|diagram/i.test(contentType)
      ? collectStringLeaves(record)
      : [];

  const codeCandidate = chooseBestCodeCandidate(
    [...primaryCodeCandidates, ...deepLeafCandidates],
    language,
    contentType,
  );
  if (codeCandidate) {
    return [wrapCodeFence(codeCandidate, language || 'text')];
  }

  const nestedParts = [
    ...renderConversationPart(record.text),
    ...renderConversationPart(record.content),
    ...renderConversationPart(record.parts),
    ...renderConversationPart(record.value),
    ...renderConversationPart(record.markdown),
    ...renderConversationPart(record.body),
    ...renderConversationPart(record.children),
  ];

  const uniqueParts: string[] = [];
  nestedParts.forEach((part) => {
    if (part && uniqueParts[uniqueParts.length - 1] !== part) {
      uniqueParts.push(part);
    }
  });

  return uniqueParts;
};

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

const buildConversationFromMapping = (
  conversation: MappingConversation,
  fallbackUrl: string,
): ConversationCandidate | null => {
  if (!conversation.mapping || !conversation.current_node) {
    return null;
  }

  const orderedNodes: ConversationMappingNode[] = [];
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
      const contentType = message?.content?.content_type;
      const text = normalizeMessageText(
        renderConversationPart(message?.content).join('\n\n'),
      );
      const metadata = message?.metadata ?? {};

      if (
        (role !== 'assistant' && role !== 'user') ||
        (contentType && contentType !== 'text') ||
        (message?.status && message.status !== 'finished_successfully') ||
        !text ||
        metadata.is_visually_hidden_from_conversation === true ||
        metadata.is_redacted === true
      ) {
        return null;
      }

      return {
        role,
        sources: [],
        text,
      } as SharedConversationMessage;
    })
    .filter((message): message is SharedConversationMessage => !!message);

  if (messages.length === 0) {
    return null;
  }

  return {
    messages,
    sourceUrl: fallbackUrl,
    summary: messages[0].text.replace(/\n/g, ' ').slice(0, 80),
    title: sanitizeConversationTitle(conversation.title ?? 'ChatGPT 대화'),
  };
};

const findConversationRoot = (value: unknown): MappingConversation | null => {
  const queue: unknown[] = [value];
  const visited = new WeakSet<object>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') {
      continue;
    }

    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    const record = current as Record<string, unknown>;
    if (
      typeof record.current_node === 'string' &&
      record.mapping &&
      typeof record.mapping === 'object'
    ) {
      return record as MappingConversation;
    }

    Object.values(record).forEach((entry) => {
      if (entry && typeof entry === 'object') {
        queue.push(entry);
      }
    });
  }

  return null;
};

export const parseChatGptConversationJsonPayload = (
  payload: unknown,
  fallbackUrl: string,
): ConversationCandidate | null => {
  const conversationRoot = findConversationRoot(payload);
  if (!conversationRoot) {
    return null;
  }

  return buildConversationFromMapping(conversationRoot, fallbackUrl);
};

const parseJsonConversationBody = (
  text: string,
  fallbackUrl: string,
): ConversationCandidate | null => {
  const candidates = [text.trim(), text.trim().replace(/^for\s*\(;;\);\s*/, '')];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      const parsed = JSON.parse(candidate) as unknown;
      const conversation = parseChatGptConversationJsonPayload(parsed, fallbackUrl);
      if (conversation) {
        return conversation;
      }
    } catch {
      // Ignore JSON parse failures and continue with other parsers.
    }
  }

  return null;
};

const parseRscConversationBody = (
  text: string,
  fallbackUrl: string,
): ConversationCandidate | null => {
  const rawPayload = extractLargestRscPayload(text);
  if (!rawPayload) {
    return null;
  }

  try {
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

    const conversation = resolveValue(rootObject) as MappingConversation;
    return buildConversationFromMapping(conversation, fallbackUrl);
  } catch {
    return null;
  }
};

const parseHtmlConversationBody = (
  text: string,
  fallbackUrl: string,
): ConversationCandidate | null => {
  if (!/<html[\s\S]*?<body/i.test(text) && !/<main[\s\S]*?<\/main>/i.test(text)) {
    return null;
  }

  const htmlConversation = parseChatGptConversationDocumentHtml(text, fallbackUrl);
  if (htmlConversation) {
    return htmlConversation;
  }

  const scriptContents = [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(
    (match) => match[1],
  );

  const nextFlightChunks = scriptContents.flatMap((scriptContent) =>
    [...scriptContent.matchAll(/__next_f\.push\(\s*\[\s*\d+\s*,\s*"([\s\S]*?)"\s*\]\s*\)/g)]
      .map((match) => match[1])
      .map((payload) => {
        try {
          return decodeRscPayload(payload);
        } catch {
          return '';
        }
      })
      .filter(Boolean),
  );

  const embeddedCandidates = [...scriptContents, ...nextFlightChunks];
  for (const candidate of embeddedCandidates) {
    const jsonConversation = parseJsonConversationBody(candidate, fallbackUrl);
    if (jsonConversation) {
      return jsonConversation;
    }

    const rscConversation = parseRscConversationBody(candidate, fallbackUrl);
    if (rscConversation) {
      return rscConversation;
    }
  }

  return null;
};

const isLikelyConversationBody = (record: ChatGptConversationNetworkRecord) => {
  const normalizedUrl = record.url.toLowerCase();
  const normalizedMimeType = (record.mimeType || '').toLowerCase();

  return (
    normalizedUrl.includes('/backend-api/') ||
    normalizedUrl.includes('/conversation') ||
    normalizedMimeType.includes('json') ||
    normalizedMimeType.includes('html') ||
    normalizedMimeType.includes('x-component')
  );
};

const scoreConversation = (conversation: ConversationCandidate): number => {
  const totalLength = conversation.messages.reduce(
    (sum, message) => sum + message.text.length,
    0,
  );
  const fencedCodeBlocks = conversation.messages.reduce(
    (sum, message) => sum + (message.text.match(LANGUAGE_FENCE_PATTERN)?.length ?? 0),
    0,
  );
  const mermaidBlocks = conversation.messages.reduce(
    (sum, message) => sum + (message.text.match(/```mermaid\n[\s\S]*?```/g)?.length ?? 0),
    0,
  );

  return (
    conversation.messages.length * 1_000 +
    totalLength +
    fencedCodeBlocks * 2_500 +
    mermaidBlocks * 5_000
  );
};

const buildRecordCandidates = (
  records: ChatGptConversationNetworkRecord[],
  fallbackUrl: string,
): RecordConversationCandidate[] => {
  const relevantRecords = records
    .filter((record) => record.status >= 200 && record.status < 300)
    .filter(isLikelyConversationBody)
    .slice()
    .reverse();

  const candidates: RecordConversationCandidate[] = [];

  relevantRecords.forEach((record) => {
    const jsonConversation = parseJsonConversationBody(record.bodyText, fallbackUrl);
    if (jsonConversation) {
      candidates.push({
        conversation: jsonConversation,
        parser: 'json',
        record,
        score: scoreConversation(jsonConversation),
      });
    }

    const rscConversation = parseRscConversationBody(record.bodyText, fallbackUrl);
    if (rscConversation) {
      candidates.push({
        conversation: rscConversation,
        parser: 'rsc',
        record,
        score: scoreConversation(rscConversation),
      });
    }

    const htmlConversation = parseHtmlConversationBody(record.bodyText, fallbackUrl);
    if (htmlConversation) {
      candidates.push({
        conversation: htmlConversation,
        parser: 'html',
        record,
        score: scoreConversation(htmlConversation),
      });
    }
  });

  return candidates;
};

const countMermaidSignals = (value: string): number => {
  const matches = value.match(MERMAID_SOURCE_PATTERN);
  return matches ? matches.length : 0;
};

const trimDiagnosticUrl = (value: string): string => {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
};

const extractDiagnosticSnippet = (value: string): string => {
  const signalMatch =
    value.match(
      /(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|xychart-beta|xychart|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|requirementDiagram|block-beta|architecture-beta|subgraph|-->)/i,
    ) ??
    value.match(/"mapping"\s*:/i) ??
    value.match(/"current_node"\s*:/i);

  if (!signalMatch || typeof signalMatch.index !== 'number') {
    return '';
  }

  const start = Math.max(0, signalMatch.index - 80);
  const end = Math.min(value.length, signalMatch.index + 180);
  return value
    .slice(start, end)
    .replace(/\s+/g, ' ')
    .trim();
};

export const buildChatGptConversationNetworkDiagnostics = (
  records: ChatGptConversationNetworkRecord[],
  fallbackUrl: string,
): string => {
  const relevantRecords = records
    .filter((record) => record.status >= 200 && record.status < 300)
    .filter(isLikelyConversationBody)
    .slice()
    .reverse();
  const candidates = buildRecordCandidates(records, fallbackUrl);
  const selectedCandidate = candidates
    .slice()
    .sort((left, right) => right.score - left.score)[0];

  const lines = [
    `network-records: total=${records.length} relevant=${relevantRecords.length} candidates=${candidates.length}`,
  ];

  relevantRecords.forEach((record, index) => {
    const recordCandidates = candidates.filter((candidate) => candidate.record === record);
    const bestRecordCandidate = recordCandidates
      .slice()
      .sort((left, right) => right.score - left.score)[0];
    const mermaidSignalCount = countMermaidSignals(record.bodyText);

    lines.push(
      `record[${index + 1}]: status=${record.status} type=${record.resourceType || 'Other'} mime=${record.mimeType || '-'} url=${trimDiagnosticUrl(record.url)} body=${record.bodyText.length} mermaidSignals=${mermaidSignalCount} candidates=${recordCandidates.length}${bestRecordCandidate ? ` best=${bestRecordCandidate.parser}:${bestRecordCandidate.score}:messages=${bestRecordCandidate.conversation.messages.length}` : ''}`,
    );

    if (mermaidSignalCount > 0 && !bestRecordCandidate) {
      const diagnosticSnippet = extractDiagnosticSnippet(record.bodyText);
      if (diagnosticSnippet) {
        lines.push(`record[${index + 1}]-snippet: ${diagnosticSnippet}`);
      }
    }
  });

  if (selectedCandidate) {
    const mermaidBlocks = selectedCandidate.conversation.messages.reduce(
      (sum, message) => sum + (message.text.match(/```mermaid\n[\s\S]*?```/g)?.length ?? 0),
      0,
    );
    const fencedBlocks = selectedCandidate.conversation.messages.reduce(
      (sum, message) => sum + (message.text.match(LANGUAGE_FENCE_PATTERN)?.length ?? 0),
      0,
    );
    lines.push(
      `selected: parser=${selectedCandidate.parser} score=${selectedCandidate.score} url=${trimDiagnosticUrl(selectedCandidate.record.url)} messages=${selectedCandidate.conversation.messages.length} fenced=${fencedBlocks} mermaid=${mermaidBlocks}`,
    );
  } else {
    lines.push('selected: none');
  }

  return lines.join('\n');
};

export const parseChatGptConversationNetworkRecords = (
  records: ChatGptConversationNetworkRecord[],
  fallbackUrl: string,
): ConversationCandidate | null => {
  const bestCandidate = buildRecordCandidates(records, fallbackUrl)
    .sort((left, right) => right.score - left.score)[0];

  return bestCandidate?.conversation ?? null;
};
