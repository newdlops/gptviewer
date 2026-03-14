import type {
  SharedConversationImport,
  SharedConversationMessage,
  SharedConversationSource,
} from '../../shared/refresh/sharedConversationRefresh';
import type { ChatGptConversationNetworkRecord } from '../services/sharedConversationRefresh/chatgpt/chatGptConversationNetworkMonitor';
import { parseChatGptConversationDocumentHtml } from './chatGptConversationHtmlParser';

const CITATION_TOKEN_PATTERN = /\uE200(?:cite|filecite|navlist)\uE202[\s\S]*?\uE201/g;
const INLINE_CITATION_TOKEN_PATTERN =
  /\uE200(filecite|cite|navlist)\uE202([^\uE202\uE201]+)(?:\uE202([^\uE201]+))?\uE201/g;

type ConversationMappingNode = {
  message?: {
    author?: { role?: string; name?: string | null };
    channel?: string | null;
    create_time?: number | null;
    content?: {
      content_type?: string;
      parts?: unknown[];
    };
    metadata?: Record<string, unknown>;
    recipient?: string | null;
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

type ReportMessageCandidate = {
  reportMessage: Record<string, unknown>;
  title: string | null;
};

type MappingNodeDescriptor = {
  nodeId: string;
  isDeepResearchPlaceholder: boolean;
  renderedMessage: SharedConversationMessage | null;
  reportAssistantMessages: SharedConversationMessage[];
};

const NON_IMPORTABLE_CONTENT_TYPES = new Set([
  'model_editable_context',
  'reasoning_recap',
  'thoughts',
]);

const MERMAID_SOURCE_PATTERN =
  /(^|\n)\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|xychart-beta|xychart|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|requirementDiagram|block-beta|architecture-beta)\b|-->|\bsubgraph\b/;
const LANGUAGE_FENCE_PATTERN = /```([\w#+.-]+)?\n[\s\S]*?```/g;
const LANGUAGE_ONLY_PATTERN =
  /^(mermaid|java|javascript|typescript|python|json|yaml|xml|html|sql|bash|shell|tsx|jsx|css|markdown|svg)$/i;
const MERMAID_LOADING_TEXT_PATTERN =
  /^(?:mermaid\s*)?(?:다이어그램\s*)?불러오는 중(?:\.{3}|…)?$/i;
const HTTP_HEADER_CODE_PATTERN =
  /^https?:\/\/|^httphttp\/1\.[01]\s+\d{3}|^http\/1\.[01]\s+\d{3}/i;
const IMAGE_CONTENT_HINT_PATTERN = /(image|img|photo|picture|thumbnail|preview|avatar|asset_pointer)/i;
const IMAGE_CONTENT_TYPE_PATTERN =
  /(image|image_asset_pointer|multimodal_image|input_image|output_image)/i;
const IMAGE_MIME_TYPE_PATTERN = /^image\//i;
const IMAGE_URL_PATTERN =
  /^(data:image\/[a-z0-9.+-]+;base64,|https?:\/\/.+\.(?:png|jpe?g|gif|webp|avif|bmp|svg)(?:[?#].*)?$|https?:\/\/(?:[^/?#]+\.)?oaiusercontent\.com\/.+)/i;
const FILE_SERVICE_POINTER_PATTERN = /^file-service:\/\/(.+)/i;
const SEDIMENT_POINTER_PATTERN = /^sediment:\/\/(file_[a-z0-9_-]+)/i;
const WIDGET_STATE_MARKER = 'The latest state of the widget is:';
const DEEP_RESEARCH_APP_PATH_PATTERN = /^\/Deep Research App\//i;
const DEEP_RESEARCH_CONNECTOR_PATTERN =
  /implicit_link::connector_openai_deep_research|connector_openai_deep_research/i;

const decodeRscPayload = (value: string): string => JSON.parse(`"${value}"`);

const sanitizeConversationTitle = (title: string): string =>
  title
    .replace(/^ChatGPT\s*-\s*/i, '')
    .replace(/\s*[|-]\s*ChatGPT$/i, '')
    .replace(/\s+[|·-]\s+OpenAI$/i, '')
    .trim() || 'ChatGPT 대화';

const extractHeadingTitle = (text: string): string | null => {
  const headingMatch = text.match(/^#\s+(.+)$/m);
  if (headingMatch?.[1]) {
    return headingMatch[1].trim();
  }

  return null;
};

const tryParseJsonRecord = (value: string): Record<string, unknown> | null => {
  const trimmedValue = value.trim();
  if (!trimmedValue.startsWith('{') || !trimmedValue.endsWith('}')) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmedValue) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const isDeepResearchSteerPayloadText = (value: string): boolean => {
  const parsedRecord = tryParseJsonRecord(value);
  if (!parsedRecord) {
    return false;
  }

  const path = parsedRecord.path;
  const args = parsedRecord.args;

  return (
    typeof path === 'string' &&
    DEEP_RESEARCH_APP_PATH_PATTERN.test(path) &&
    DEEP_RESEARCH_CONNECTOR_PATTERN.test(path) &&
    typeof args === 'object' &&
    !!args
  );
};

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

const escapeHtmlEntities = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

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
  const escapedValue =
    normalizedLanguage === 'html'
      ? escapeHtmlEntities(normalizedValue)
      : normalizedValue;
  return `\`\`\`${normalizedLanguage}\n${escapedValue}\n\`\`\``;
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

const isLikelyImageKey = (key: string): boolean =>
  IMAGE_CONTENT_HINT_PATTERN.test(key);

const normalizeRenderableImageUrl = (value: string): string => {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return '';
  }

  if (trimmedValue.startsWith('//')) {
    return `https:${trimmedValue}`;
  }

  return trimmedValue;
};

const isRenderableImageUrl = (value: string): boolean =>
  IMAGE_URL_PATTERN.test(normalizeRenderableImageUrl(value));

const isLikelyImageContext = (
  record: Record<string, unknown>,
  parentContext: boolean,
): boolean => {
  if (parentContext) {
    return true;
  }

  const contentType = String(record.content_type ?? record.type ?? record.kind ?? '');
  if (IMAGE_CONTENT_TYPE_PATTERN.test(contentType)) {
    return true;
  }

  const mimeTypeCandidates = [
    record.mime_type,
    record.mimeType,
    record.file_type,
    record.fileType,
  ];

  if (
    mimeTypeCandidates.some(
      (candidate) =>
        typeof candidate === 'string' &&
        IMAGE_MIME_TYPE_PATTERN.test(candidate.trim().toLowerCase()),
    )
  ) {
    return true;
  }

  return Object.keys(record).some((key) => isLikelyImageKey(key));
};

const collectImageParts = (
  value: unknown,
  parentContext = false,
  visited = new WeakSet<object>(),
): string[] => {
  if (!value) {
    return [];
  }

  if (typeof value === 'string') {
    const normalizedValue = normalizeRenderableImageUrl(value);
    if (isRenderableImageUrl(normalizedValue)) {
      return [`![image](${normalizedValue})`];
    }

    const sedimentPointerMatch = normalizedValue.match(SEDIMENT_POINTER_PATTERN);
    if (sedimentPointerMatch?.[1]) {
      return [`![image](sediment://${sedimentPointerMatch[1]})`];
    }

    const pointerMatch = normalizedValue.match(FILE_SERVICE_POINTER_PATTERN);
    if (pointerMatch?.[1]) {
      return [`[이미지 첨부: ${pointerMatch[1]}]`];
    }

    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectImageParts(entry, parentContext, visited));
  }

  if (typeof value !== 'object') {
    return [];
  }

  if (visited.has(value)) {
    return [];
  }
  visited.add(value);

  const record = value as Record<string, unknown>;
  const imageContext = isLikelyImageContext(record, parentContext);
  const imageParts: string[] = [];

  Object.entries(record).forEach(([key, entry]) => {
    if (typeof entry === 'string') {
      const normalizedEntry = normalizeRenderableImageUrl(entry);
      if (isRenderableImageUrl(normalizedEntry) && (imageContext || isLikelyImageKey(key))) {
        imageParts.push(`![image](${normalizedEntry})`);
        return;
      }

      const sedimentPointerMatch = normalizedEntry.match(SEDIMENT_POINTER_PATTERN);
      if (
        sedimentPointerMatch?.[1] &&
        (imageContext ||
          isLikelyImageKey(key) ||
          key === 'asset_pointer' ||
          key === 'watermarked_asset_pointer')
      ) {
        imageParts.push(`![image](sediment://${sedimentPointerMatch[1]})`);
        return;
      }

      const pointerMatch = normalizedEntry.match(FILE_SERVICE_POINTER_PATTERN);
      if (
        pointerMatch?.[1] &&
        (imageContext || isLikelyImageKey(key) || key === 'asset_pointer')
      ) {
        imageParts.push(`[이미지 첨부: ${pointerMatch[1]}]`);
      }
      return;
    }

    imageParts.push(
      ...collectImageParts(entry, imageContext || isLikelyImageKey(key), visited),
    );
  });

  return imageParts;
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
    if (!value.trim() || isDeepResearchSteerPayloadText(value)) {
      return [];
    }

    return [value];
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
  const imageParts = collectImageParts(record);
  if (imageParts.length > 0) {
    return [...new Set(imageParts)];
  }

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

const containsDeepResearchPayloadText = (value: unknown): boolean => {
  if (typeof value === 'string') {
    return (
      isDeepResearchSteerPayloadText(value) ||
      isWidgetStatePayloadText(value) ||
      value.includes(WIDGET_STATE_MARKER)
    );
  }

  if (Array.isArray(value)) {
    return value.some((entry) => containsDeepResearchPayloadText(entry));
  }

  if (!value || typeof value !== 'object') {
    return false;
  }

  return Object.values(value as Record<string, unknown>).some((entry) =>
    containsDeepResearchPayloadText(entry),
  );
};

const getOrderedMappingNodes = (
  conversation: MappingConversation,
): Array<{ id: string; node: ConversationMappingNode }> => {
  if (!conversation.mapping || !conversation.current_node) {
    return [];
  }

  const orderedNodes: Array<{ id: string; node: ConversationMappingNode }> = [];
  const visitedNodeIds = new Set<string>();
  let currentNodeId: string | null = conversation.current_node;

  while (
    currentNodeId &&
    !visitedNodeIds.has(currentNodeId) &&
    conversation.mapping[currentNodeId]
  ) {
    visitedNodeIds.add(currentNodeId);
    orderedNodes.push({
      id: currentNodeId,
      node: conversation.mapping[currentNodeId],
    });
    currentNodeId = conversation.mapping[currentNodeId].parent ?? null;
  }

  orderedNodes.reverse();
  return orderedNodes;
};

const hasImagePayloadInNode = (node: ConversationMappingNode): boolean =>
  collectImageParts(node.message?.content).length > 0 ||
  collectImageParts(node.message?.metadata).length > 0;

const getMessageCreateTime = (node: ConversationMappingNode): number => {
  const createTime = node.message?.create_time;
  return typeof createTime === 'number' && Number.isFinite(createTime)
    ? createTime
    : Number.POSITIVE_INFINITY;
};

const getReportAssistantMessage = (
  candidate: ConversationCandidate,
): SharedConversationMessage | null => {
  const message = candidate.messages.find((m) => m.role === 'assistant');
  if (!message) {
    return null;
  }

  return {
    authorName: message.authorName,
    role: 'assistant',
    sources: message.sources || [],
    text: message.text,
  };
};

const buildReportAssistantMessages = (
  payload: unknown,
  fallbackUrl: string,
  seenFingerprints: Set<string>,
): SharedConversationMessage[] =>
  buildReportMessageConversations(payload, fallbackUrl)
    .map((conversation) => getReportAssistantMessage(conversation))
    .filter((message): message is SharedConversationMessage => !!message)
    .filter((message) => {
      const fingerprint = message.text.trim();
      if (!fingerprint || seenFingerprints.has(fingerprint)) {
        return false;
      }

      seenFingerprints.add(fingerprint);
      return true;
    });

const extractMessageSourcesFromMetadata = (metadata: Record<string, any>): SharedConversationSource[] => {
  const sources: SharedConversationSource[] = [];
  const dedup = new Set<string>();

  const addSource = (url: string, title: string, attribution?: string, description?: string) => {
    if (!url || dedup.has(url)) return;
    dedup.add(url);
    sources.push({ url, title, attribution, description });
  };

  if (Array.isArray(metadata.search_result_groups)) {
    for (const group of metadata.search_result_groups) {
      if (Array.isArray(group.entries)) {
        for (const entry of group.entries) {
          if (entry.type === 'search_result' && entry.url) {
            addSource(entry.url, entry.title || entry.url, entry.attribution, entry.snippet);
          }
        }
      }
    }
  }

  if (Array.isArray(metadata.content_references)) {
    for (const ref of metadata.content_references) {
      if (Array.isArray(ref.items)) {
        for (const item of ref.items) {
          if (item.url) {
            addSource(item.url, item.title || item.url, item.attribution, item.snippet);
          }
        }
      }
      if (Array.isArray(ref.sources)) {
          for (const src of ref.sources) {
              if (src.url) {
                  addSource(src.url, src.title || src.url, src.attribution, src.snippet);
              }
          }
      }
    }
  }

  return sources;
};

const buildRenderedMappingMessage = (
  node: ConversationMappingNode,
): SharedConversationMessage | null => {
  const message = node.message;
  const rawRole = message?.author?.role;
  const contentType = message?.content?.content_type;
  const contentParts = renderConversationPart(message?.content);
  const metadataImageParts = collectImageParts(message?.metadata ?? {});
  const hasImagePayload =
    collectImageParts(message?.content).length > 0 || metadataImageParts.length > 0;
  const role = rawRole === 'tool' && hasImagePayload ? 'assistant' : rawRole;
  const metadata = message?.metadata ?? {};

  let rawText = [...contentParts, ...metadataImageParts].join('\n\n');
  if (Array.isArray(metadata.content_references)) {
      for (const ref of metadata.content_references) {
          if (ref.matched_text && typeof ref.matched_text === 'string') {
              let replacement = ref.alt;
              if (typeof replacement === 'string') {
                  // alt 값이 (【1】) 형태이거나 공백이 포함된 경우 괄호를 제거
                  replacement = replacement.trim().replace(/^\((.+)\)$/, '$1').trim();
              }
              
              if (!replacement && Array.isArray(ref.items) && ref.items.length > 0) {
                 replacement = `[${ref.items[0].title || ref.items[0].attribution || '출처'}](${ref.items[0].url})`;
              } else if (!replacement && Array.isArray(ref.sources) && ref.sources.length > 0) {
                 replacement = `[${ref.sources[0].title || ref.sources[0].attribution || '출처'}](${ref.sources[0].url})`;
              }
              
              if (replacement) {
                  // 텍스트 본문에서 (토큰) 형태인 경우 괄호까지 함께 치환하여 제거
                  const parenthesizedToken = `(${ref.matched_text})`;
                  if (rawText.includes(parenthesizedToken)) {
                      rawText = rawText.split(parenthesizedToken).join(replacement);
                  } else {
                      rawText = rawText.replace(ref.matched_text, replacement);
                  }
              }
          }
      }
  }

  const text = normalizeMessageText(rawText);
  const channel =
    typeof message?.channel === 'string' ? message.channel.toLowerCase() : null;
  const recipient =
    typeof message?.recipient === 'string' ? message.recipient.toLowerCase() : null;
  const isInternalChannel = channel === 'commentary';
  const isNonPublicRecipient =
    typeof recipient === 'string' &&
    recipient.length > 0 &&
    recipient !== 'all' &&
    recipient !== 'assistant' &&
    recipient !== 'user';
  const shouldBypassVisibilityFilter = hasImagePayload;

  if (
    (!shouldBypassVisibilityFilter && isInternalChannel) ||
    (!shouldBypassVisibilityFilter && isNonPublicRecipient) ||
    (role !== 'assistant' && role !== 'user') ||
    (contentType && NON_IMPORTABLE_CONTENT_TYPES.has(contentType)) ||
    (message?.status && message.status !== 'finished_successfully') ||
    !text ||
    metadata.is_visually_hidden_from_conversation === true ||
    metadata.is_redacted === true ||
    metadata.reasoning_status === 'is_reasoning'
  ) {
    return null;
  }

  const authorName = message?.author?.name || undefined;
  const sources = extractMessageSourcesFromMetadata(metadata);

  return {
    authorName,
    role,
    sources,
    text,
  };
};

const buildMappingNodeDescriptors = (
  conversation: MappingConversation,
  fallbackUrl: string,
): MappingNodeDescriptor[] => {
  const seenReportFingerprints = new Set<string>();
  const orderedEntries = getOrderedMappingNodes(conversation);
  const orderedNodeIdToIndex = new Map<string, number>();
  orderedEntries.forEach((entry, index) => {
    orderedNodeIdToIndex.set(entry.id, index);
  });

  const baseDescriptors = orderedEntries.map(({ id, node }) => {
    const message = node.message;

    return {
      nodeId: id,
      isDeepResearchPlaceholder:
        message?.author?.role === 'assistant' &&
        containsDeepResearchPayloadText(message?.content),
      renderedMessage: buildRenderedMappingMessage(node),
      reportAssistantMessages: buildReportAssistantMessages(
        {
          content: message?.content,
          metadata: message?.metadata,
        },
        fallbackUrl,
        seenReportFingerprints,
      ),
    };
  });

  const mapping = conversation.mapping ?? {};
  const detachedImageDescriptorsByAnchor = new Map<number, MappingNodeDescriptor[]>();
  const detachedImageDescriptorsTrailing: MappingNodeDescriptor[] = [];

  Object.entries(mapping).forEach(([nodeId, node]) => {
    if (orderedNodeIdToIndex.has(nodeId) || !hasImagePayloadInNode(node)) {
      return;
    }

    const renderedMessage = buildRenderedMappingMessage(node);
    if (!renderedMessage) {
      return;
    }

    const descriptor: MappingNodeDescriptor = {
      nodeId,
      isDeepResearchPlaceholder: false,
      renderedMessage,
      reportAssistantMessages: [],
    };

    let parentId = node.parent ?? null;
    while (parentId && !orderedNodeIdToIndex.has(parentId)) {
      parentId = mapping[parentId]?.parent ?? null;
    }

    if (parentId && orderedNodeIdToIndex.has(parentId)) {
      const anchorIndex = orderedNodeIdToIndex.get(parentId);
      if (anchorIndex != null) {
        const bucket = detachedImageDescriptorsByAnchor.get(anchorIndex) ?? [];
        bucket.push(descriptor);
        detachedImageDescriptorsByAnchor.set(anchorIndex, bucket);
        return;
      }
    }

    detachedImageDescriptorsTrailing.push(descriptor);
  });

  detachedImageDescriptorsByAnchor.forEach((descriptors, anchorIndex) => {
    descriptors.sort((left, right) => {
      const leftNode = mapping[left.nodeId];
      const rightNode = mapping[right.nodeId];
      const createTimeDiff =
        getMessageCreateTime(leftNode) - getMessageCreateTime(rightNode);
      if (createTimeDiff !== 0) {
        return createTimeDiff;
      }
      return left.nodeId.localeCompare(right.nodeId);
    });
    detachedImageDescriptorsByAnchor.set(anchorIndex, descriptors);
  });

  detachedImageDescriptorsTrailing.sort((left, right) => {
    const leftNode = mapping[left.nodeId];
    const rightNode = mapping[right.nodeId];
    const createTimeDiff =
      getMessageCreateTime(leftNode) - getMessageCreateTime(rightNode);
    if (createTimeDiff !== 0) {
      return createTimeDiff;
    }
    return left.nodeId.localeCompare(right.nodeId);
  });

  const mergedDescriptors: MappingNodeDescriptor[] = [];
  baseDescriptors.forEach((descriptor, index) => {
    mergedDescriptors.push(descriptor);
    const anchoredDescriptors = detachedImageDescriptorsByAnchor.get(index) ?? [];
    if (anchoredDescriptors.length > 0) {
      mergedDescriptors.push(...anchoredDescriptors);
    }
  });
  if (detachedImageDescriptorsTrailing.length > 0) {
    mergedDescriptors.push(...detachedImageDescriptorsTrailing);
  }

  return mergedDescriptors;
};

const buildConversationFromMapping = (
  conversation: MappingConversation,
  fallbackUrl: string,
  reportMessageConversations: ConversationCandidate[],
): ConversationCandidate | null => {
  const descriptors = buildMappingNodeDescriptors(conversation, fallbackUrl);
  if (descriptors.length === 0) {
    return null;
  }

  const placeholderIndices = descriptors
    .map((descriptor, index) =>
      descriptor.isDeepResearchPlaceholder ? index : -1,
    )
    .filter((index) => index >= 0);
  const remainingPlaceholderIndices = [...placeholderIndices];
  const assignedReportsByPlaceholder = new Map<number, SharedConversationMessage[]>();
  const extraReportsByNode = new Map<number, SharedConversationMessage[]>();

  descriptors.forEach((descriptor, descriptorIndex) => {
    descriptor.reportAssistantMessages.forEach((reportAssistantMessage) => {
      let placeholderListIndex = -1;

      for (
        let index = remainingPlaceholderIndices.length - 1;
        index >= 0;
        index -= 1
      ) {
        if (remainingPlaceholderIndices[index] <= descriptorIndex) {
          placeholderListIndex = index;
          break;
        }
      }

      if (placeholderListIndex < 0 && remainingPlaceholderIndices.length > 0) {
        placeholderListIndex = 0;
      }

      if (placeholderListIndex >= 0) {
        const placeholderIndex = remainingPlaceholderIndices.splice(
          placeholderListIndex,
          1,
        )[0];
        const assignedReports = assignedReportsByPlaceholder.get(placeholderIndex) ?? [];
        assignedReports.push(reportAssistantMessage);
        assignedReportsByPlaceholder.set(placeholderIndex, assignedReports);
        return;
      }

      const extraReports = extraReportsByNode.get(descriptorIndex) ?? [];
      extraReports.push(reportAssistantMessage);
      extraReportsByNode.set(descriptorIndex, extraReports);
    });
  });

  const seenRenderedReportFingerprints = new Set<string>();
  const remainingGlobalReports = reportMessageConversations
    .map((conversationCandidate) => getReportAssistantMessage(conversationCandidate))
    .filter((message): message is SharedConversationMessage => !!message)
    .filter((message) => {
      const fingerprint = message.text.trim();
      if (!fingerprint || seenRenderedReportFingerprints.has(fingerprint)) {
        return false;
      }

      seenRenderedReportFingerprints.add(fingerprint);
      return true;
    })
    .filter((message) => {
      const fingerprint = message.text.trim();
      const isAlreadyAssigned = [...assignedReportsByPlaceholder.values()]
        .flat()
        .concat([...extraReportsByNode.values()].flat())
        .some((assignedMessage) => assignedMessage.text.trim() === fingerprint);
      return !isAlreadyAssigned;
    })
    .map((message) => ({
      ...message,
      sources: [...message.sources],
    }));

  remainingGlobalReports.forEach((reportAssistantMessage) => {
    if (remainingPlaceholderIndices.length > 0) {
      const placeholderIndex = remainingPlaceholderIndices.shift();
      if (placeholderIndex == null) {
        return;
      }
      const assignedReports = assignedReportsByPlaceholder.get(placeholderIndex) ?? [];
      assignedReports.push(reportAssistantMessage);
      assignedReportsByPlaceholder.set(placeholderIndex, assignedReports);
      return;
    }

    const trailingReports =
      extraReportsByNode.get(descriptors.length - 1) ?? [];
    trailingReports.push(reportAssistantMessage);
    extraReportsByNode.set(descriptors.length - 1, trailingReports);
  });

  const messages: SharedConversationMessage[] = [];
  descriptors.forEach((descriptor, descriptorIndex) => {
    const assignedReports = assignedReportsByPlaceholder.get(descriptorIndex) ?? [];
    const extraReports = extraReportsByNode.get(descriptorIndex) ?? [];

    if (descriptor.isDeepResearchPlaceholder) {
      if (assignedReports.length > 0) {
        messages.push(...assignedReports);
      }
      return;
    }

    if (descriptor.renderedMessage) {
      messages.push(descriptor.renderedMessage);
    }

    if (extraReports.length > 0) {
      messages.push(...extraReports);
    }
  });

  if (messages.length === 0) {
    return null;
  }

  const bestReportConversation =
    [...reportMessageConversations].sort(
      (left, right) => scoreConversation(right) - scoreConversation(left),
    )[0] ?? null;

  return {
    messages,
    sourceUrl: fallbackUrl,
    summary:
      bestReportConversation &&
      bestReportConversation.summary.length > messages[0].text.length
        ? bestReportConversation.summary
        : messages[0].text.replace(/\n/g, ' ').slice(0, 80),
    title: sanitizeConversationTitle(conversation.title ?? 'ChatGPT 대화'),
  };
};

const extractEmbeddedWidgetState = (value: string): unknown | null => {
  const markerIndex = value.indexOf(WIDGET_STATE_MARKER);
  if (markerIndex < 0) {
    return null;
  }

  const objectStartIndex = value.indexOf('{', markerIndex + WIDGET_STATE_MARKER.length);
  if (objectStartIndex < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = objectStartIndex; index < value.length; index += 1) {
    const character = value[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (character === '\\') {
        isEscaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === '{') {
      depth += 1;
      continue;
    }

    if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(value.slice(objectStartIndex, index + 1)) as unknown;
        } catch {
          return null;
        }
      }
    }
  }

  return null;
};

const extractWidgetStatePayload = (
  value: unknown,
  depth = 0,
): Record<string, unknown> | null => {
  if (depth > 8 || value == null) {
    return null;
  }

  if (typeof value === 'string') {
    const embeddedWidgetState = extractEmbeddedWidgetState(value);
    if (embeddedWidgetState) {
      return extractWidgetStatePayload(embeddedWidgetState, depth + 1);
    }

    const parsedRecord = tryParseJsonRecord(value);
    if (!parsedRecord) {
      return null;
    }

    return extractWidgetStatePayload(parsedRecord, depth + 1);
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const nestedPayload = extractWidgetStatePayload(entry, depth + 1);
      if (nestedPayload) {
        return nestedPayload;
      }
    }

    return null;
  }

  if (typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (record.report_message && typeof record.report_message === 'object') {
    return record;
  }

  for (const key of ['widget_state', 'venus_widget_state']) {
    if (!(key in record)) {
      continue;
    }

    const nestedPayload = extractWidgetStatePayload(record[key], depth + 1);
    if (nestedPayload) {
      return nestedPayload;
    }
  }

  return null;
};

const isWidgetStatePayloadText = (value: string): boolean =>
  !!extractWidgetStatePayload(value);

const buildConversationFromReportMessage = (
  reportMessage: Record<string, unknown>,
  fallbackUrl: string,
  title: string | null,
): ConversationCandidate | null => {
  const author = reportMessage.author;
  const authorRole =
    author && typeof author === 'object'
      ? (author as { role?: unknown }).role
      : undefined;
  const authorName =
    author && typeof author === 'object'
      ? (author as { name?: unknown }).name
      : undefined;
  const content = reportMessage.content;
  const contentType =
    content && typeof content === 'object'
      ? (content as { content_type?: unknown }).content_type
      : undefined;
  const parts =
    content && typeof content === 'object'
      ? renderConversationPart((content as { parts?: unknown }).parts ?? content)
      : [];
  
  const metadata = (reportMessage.metadata as Record<string, any>) || {};
  let rawText = parts.join('\n\n');
  
  // Resolve content references
  if (Array.isArray(metadata.content_references)) {
      for (const ref of metadata.content_references) {
          if (ref.matched_text && typeof ref.matched_text === 'string') {
              let replacement = ref.alt;
              if (typeof replacement === 'string') {
                  // alt 값이 (【1】) 형태인 경우 괄호를 제거
                  replacement = replacement.replace(/^\((.+)\)$/, '$1');
              }
              
              if (!replacement && Array.isArray(ref.items) && ref.items.length > 0) {
                 replacement = `[${ref.items[0].title || ref.items[0].attribution || '출처'}](${ref.items[0].url})`;
              }
              if (replacement) {
                  rawText = rawText.replace(ref.matched_text, replacement);
              }
          }
      }
  }

  const text = normalizeMessageText(rawText);
  const normalizedTitle = sanitizeConversationTitle(
    extractHeadingTitle(text) ?? title ?? 'Deep Research 결과',
  );

  if (authorRole !== 'assistant' || contentType !== 'text' || !text) {
    return null;
  }

  const sources = extractMessageSourcesFromMetadata(metadata);

  return {
    messages: [
      {
        authorName: typeof authorName === 'string' ? authorName : undefined,
        role: 'assistant',
        sources,
        text,
      },
    ],
    sourceUrl: fallbackUrl,
    summary: text.replace(/\n/g, ' ').slice(0, 80),
    title: normalizedTitle,
  };
};

const buildReportMessageConversations = (
  payload: unknown,
  fallbackUrl: string,
): ConversationCandidate[] => {
  const seenFingerprints = new Set<string>();

  return collectReportMessageCandidates(payload)
    .map((candidate) =>
      buildConversationFromReportMessage(
        candidate.reportMessage,
        fallbackUrl,
        candidate.title,
      ),
    )
    .filter((candidate): candidate is ConversationCandidate => !!candidate)
    .filter((candidate) => {
      const reportAssistantMessage = getReportAssistantMessage(candidate);
      if (!reportAssistantMessage) {
        return false;
      }

      const fingerprint = `${candidate.title}\u0000${reportAssistantMessage.text.trim()}`;
      if (seenFingerprints.has(fingerprint)) {
        return false;
      }

      seenFingerprints.add(fingerprint);
      return true;
    });
};

const buildConversationFromReportMessages = (
  reportMessageConversations: ConversationCandidate[],
  fallbackUrl: string,
): ConversationCandidate | null => {
  const reportAssistantMessages = reportMessageConversations
    .map((conversation) => getReportAssistantMessage(conversation))
    .filter((message): message is SharedConversationMessage => !!message);

  if (reportAssistantMessages.length === 0) {
    return null;
  }

  const bestConversation =
    [...reportMessageConversations].sort(
      (left, right) => scoreConversation(right) - scoreConversation(left),
    )[0] ?? null;

  return {
    messages: reportAssistantMessages.map((message) => ({
      ...message,
      sources: [...message.sources],
    })),
    sourceUrl: fallbackUrl,
    summary:
      bestConversation?.summary ??
      reportAssistantMessages[0].text.replace(/\n/g, ' ').slice(0, 80),
    title:
      bestConversation?.title ??
      sanitizeConversationTitle('Deep Research 결과'),
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

const collectReportMessageCandidates = (payload: unknown): ReportMessageCandidate[] => {
  const queue: Array<{ value: unknown; title: string | null }> = [
    { value: payload, title: null },
  ];
  const visited = new WeakSet<object>();
  const widgetStateFingerprints = new Set<string>();
  const reportMessageFingerprints = new Set<string>();
  const candidates: ReportMessageCandidate[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const { value, title } = current;
    if (typeof value === 'string') {
      const widgetStatePayload = extractWidgetStatePayload(value);
      if (widgetStatePayload) {
        const fingerprint = JSON.stringify(widgetStatePayload);
        if (!widgetStateFingerprints.has(fingerprint)) {
          widgetStateFingerprints.add(fingerprint);
          queue.push({ value: widgetStatePayload, title });
        }
      }
      continue;
    }

    if (!value || typeof value !== 'object') {
      continue;
    }

    if (visited.has(value)) {
      continue;
    }
    visited.add(value);

    const record = value as Record<string, unknown>;
    const plan = record.plan;
    const nextTitle =
      typeof record.title === 'string'
        ? record.title
        : plan &&
            typeof plan === 'object' &&
            typeof (plan as { title?: unknown }).title === 'string'
          ? ((plan as { title?: string }).title ?? null)
          : title;

    if (record.report_message && typeof record.report_message === 'object') {
      const fingerprint = JSON.stringify(record.report_message);
      if (!reportMessageFingerprints.has(fingerprint)) {
        reportMessageFingerprints.add(fingerprint);
        candidates.push({
          reportMessage: record.report_message as Record<string, unknown>,
          title: nextTitle,
        });
      }
    }

    Object.values(record).forEach((entry) => {
      if (entry && (typeof entry === 'object' || typeof entry === 'string')) {
        queue.push({ value: entry, title: nextTitle });
      }
    });
  }

  return candidates;
};

export const parseChatGptConversationJsonPayload = (
  payload: unknown,
  fallbackUrl: string,
): ConversationCandidate | null => {
  const reportMessageConversations = buildReportMessageConversations(
    payload,
    fallbackUrl,
  );
  const mappingConversation = (() => {
    const conversationRoot = findConversationRoot(payload);
    if (!conversationRoot) {
      return null;
    }

    return buildConversationFromMapping(
      conversationRoot,
      fallbackUrl,
      reportMessageConversations,
    );
  })();

  if (mappingConversation) {
    return mappingConversation;
  }

  return (
    buildConversationFromReportMessages(reportMessageConversations, fallbackUrl) ??
    mappingConversation
  );
};

const parseSseConversationBody = (
  text: string,
  fallbackUrl: string,
): ConversationCandidate | null => {
  if (!text.includes('event: delta') && !text.includes('data: {"')) {
    return null;
  }

  const lines = text.split('\n');
  const mapping: Record<string, ConversationMappingNode> = {};
  const messageParts = new Map<string, string[]>();
  let currentNodeId: string | undefined;
  let title: string | undefined;

  for (const line of lines) {
    if (!line.startsWith('data: ')) {
      continue;
    }

    const jsonText = line.slice(6).trim();
    if (jsonText === '[DONE]') {
      break;
    }

    try {
      const payload = JSON.parse(jsonText);
      if (payload.v) {
        const v = payload.v;
        if (payload.o === 'add' && v.message) {
          const messageId = v.message.id;
          mapping[messageId] = {
            message: v.message,
            parent: v.message.metadata?.parent_id,
          };
          if (!currentNodeId || v.message.author?.role === 'assistant') {
            currentNodeId = messageId;
          }
          if (v.message.content?.parts) {
            messageParts.set(messageId, v.message.content.parts.map((p: any) => String(p)));
          }
        } else if (payload.o === 'patch' && Array.isArray(v)) {
          v.forEach((patch: any) => {
            if (patch.p?.startsWith('/message/content/parts/')) {
              // Path like /message/content/parts/0
              const partsMatch = patch.p.match(/\/message\/content\/parts\/(\d+)/);
              if (partsMatch && currentNodeId) {
                const partIndex = parseInt(partsMatch[1], 10);
                const currentParts = messageParts.get(currentNodeId) || [];
                if (patch.o === 'append') {
                  currentParts[partIndex] = (currentParts[partIndex] || '') + String(patch.v);
                } else if (patch.o === 'replace') {
                  currentParts[partIndex] = String(patch.v);
                }
                messageParts.set(currentNodeId, currentParts);

                // Update mapping node
                if (mapping[currentNodeId]) {
                  if (!mapping[currentNodeId].message!.content) {
                    mapping[currentNodeId].message!.content = { content_type: 'text', parts: [] };
                  }
                  mapping[currentNodeId].message!.content!.parts = currentParts;
                }
              }
            } else if (patch.p === '/message/status' && currentNodeId && mapping[currentNodeId]) {
               mapping[currentNodeId].message!.status = patch.v;
            } else if (patch.p === '/title' && typeof patch.v === 'string') {
               title = patch.v;
            }
          });
        }
      }

      if (payload.mapping && payload.current_node) {
          const nested = parseChatGptConversationJsonPayload(payload, fallbackUrl);
          if (nested) return nested;
      }
    } catch {
      continue;
    }
  }

  // Final pass to ensure status is set if we have at least one assistant message
  if (currentNodeId && mapping[currentNodeId]) {
      mapping[currentNodeId].message!.status = 'finished_successfully';
  }

  if (Object.keys(mapping).length > 0 && currentNodeId) {
    const reportMessageConversations = buildReportMessageConversations(
      { mapping, current_node: currentNodeId },
      fallbackUrl,
    );
    return buildConversationFromMapping(
      {
        mapping,
        current_node: currentNodeId,
        title,
      },
      fallbackUrl,
      reportMessageConversations,
    );
  }

  return null;
};

const parseJsonConversationBody = (
  text: string,
  fallbackUrl: string,
): ConversationCandidate | null => {
  const jsonConversation = (() => {
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
        // Ignore JSON parse failures and continue with other candidates.
      }
    }
    return null;
  })();

  if (jsonConversation) {
    return jsonConversation;
  }

  return parseSseConversationBody(text, fallbackUrl);
};

const parseWidgetStateConversationBody = (
  text: string,
  fallbackUrl: string,
): ConversationCandidate | null => {
  const widgetStatePayload = extractWidgetStatePayload(text);
  if (!widgetStatePayload) {
    return null;
  }

  const parsedConversation = parseChatGptConversationJsonPayload(
    widgetStatePayload,
    fallbackUrl,
  );
  if (parsedConversation) {
    return parsedConversation;
  }

  return buildConversationFromReportMessages(
    buildReportMessageConversations(widgetStatePayload, fallbackUrl),
    fallbackUrl,
  );
};

export const parseChatGptConversationBodyText = (
  text: string,
  fallbackUrl: string,
): ConversationCandidate | null => {
  const jsonConversation = parseJsonConversationBody(text, fallbackUrl);
  if (jsonConversation) {
    return jsonConversation;
  }

  const widgetConversation = parseWidgetStateConversationBody(text, fallbackUrl);
  if (widgetConversation) {
    return widgetConversation;
  }

  const rscConversation = parseRscConversationBody(text, fallbackUrl);
  if (rscConversation) {
    return rscConversation;
  }

  return parseHtmlConversationBody(text, fallbackUrl);
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
    const reportMessageConversations = buildReportMessageConversations(
      conversation,
      fallbackUrl,
    );
    return buildConversationFromMapping(
      conversation,
      fallbackUrl,
      reportMessageConversations,
    );
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
