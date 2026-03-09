"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseChatGptConversationNetworkRecords = exports.buildChatGptConversationNetworkDiagnostics = exports.parseChatGptConversationBodyText = exports.parseChatGptConversationJsonPayload = void 0;
const chatGptConversationHtmlParser_1 = require("./chatGptConversationHtmlParser");
const CITATION_TOKEN_PATTERN = /\uE200(?:cite|filecite|navlist)\uE202[\s\S]*?\uE201/g;
const INLINE_CITATION_TOKEN_PATTERN = /\uE200(filecite|cite|navlist)\uE202([^\uE202\uE201]+)(?:\uE202([^\uE201]+))?\uE201/g;
const NON_IMPORTABLE_CONTENT_TYPES = new Set([
    'model_editable_context',
    'reasoning_recap',
    'thoughts',
]);
const MERMAID_SOURCE_PATTERN = /(^|\n)\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|xychart-beta|xychart|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|requirementDiagram|block-beta|architecture-beta)\b|-->|\bsubgraph\b/;
const LANGUAGE_FENCE_PATTERN = /```([\w#+.-]+)?\n[\s\S]*?```/g;
const LANGUAGE_ONLY_PATTERN = /^(mermaid|java|javascript|typescript|python|json|yaml|xml|html|sql|bash|shell|tsx|jsx|css|markdown|svg)$/i;
const MERMAID_LOADING_TEXT_PATTERN = /^(?:mermaid\s*)?(?:다이어그램\s*)?불러오는 중(?:\.{3}|…)?$/i;
const HTTP_HEADER_CODE_PATTERN = /^https?:\/\/|^httphttp\/1\.[01]\s+\d{3}|^http\/1\.[01]\s+\d{3}/i;
const IMAGE_CONTENT_HINT_PATTERN = /(image|img|photo|picture|thumbnail|preview|avatar|asset_pointer)/i;
const IMAGE_CONTENT_TYPE_PATTERN = /(image|image_asset_pointer|multimodal_image|input_image|output_image)/i;
const IMAGE_MIME_TYPE_PATTERN = /^image\//i;
const IMAGE_URL_PATTERN = /^(data:image\/[a-z0-9.+-]+;base64,|https?:\/\/.+\.(?:png|jpe?g|gif|webp|avif|bmp|svg)(?:[?#].*)?$|https?:\/\/(?:[^/?#]+\.)?oaiusercontent\.com\/.+)/i;
const FILE_SERVICE_POINTER_PATTERN = /^file-service:\/\/(.+)/i;
const SEDIMENT_POINTER_PATTERN = /^sediment:\/\/(file_[a-z0-9]+)/i;
const WIDGET_STATE_MARKER = 'The latest state of the widget is:';
const DEEP_RESEARCH_APP_PATH_PATTERN = /^\/Deep Research App\//i;
const DEEP_RESEARCH_CONNECTOR_PATTERN = /implicit_link::connector_openai_deep_research|connector_openai_deep_research/i;
const decodeRscPayload = (value) => JSON.parse(`"${value}"`);
const sanitizeConversationTitle = (title) => title
    .replace(/^ChatGPT\s*-\s*/i, '')
    .replace(/\s*[|-]\s*ChatGPT$/i, '')
    .replace(/\s+[|·-]\s+OpenAI$/i, '')
    .trim() || 'ChatGPT 대화';
const extractHeadingTitle = (text) => {
    const headingMatch = text.match(/^#\s+(.+)$/m);
    if (headingMatch?.[1]) {
        return headingMatch[1].trim();
    }
    return null;
};
const tryParseJsonRecord = (value) => {
    const trimmedValue = value.trim();
    if (!trimmedValue.startsWith('{') || !trimmedValue.endsWith('}')) {
        return null;
    }
    try {
        const parsed = JSON.parse(trimmedValue);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : null;
    }
    catch {
        return null;
    }
};
const isDeepResearchSteerPayloadText = (value) => {
    const parsedRecord = tryParseJsonRecord(value);
    if (!parsedRecord) {
        return false;
    }
    const path = parsedRecord.path;
    const args = parsedRecord.args;
    return (typeof path === 'string' &&
        DEEP_RESEARCH_APP_PATH_PATTERN.test(path) &&
        DEEP_RESEARCH_CONNECTOR_PATTERN.test(path) &&
        typeof args === 'object' &&
        !!args);
};
const normalizeMessageText = (value) => value
    .replace(INLINE_CITATION_TOKEN_PATTERN, (_match, citationType) => citationType === 'filecite' ? '[파일 참조]' : ' ')
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
const normalizeCodeLanguage = (value) => value.trim().toLowerCase().replace(/^language[-:_]?/i, '');
const escapeHtmlEntities = (value) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
const inferObjectLanguage = (record) => {
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
        const metadataRecord = metadata;
        const nestedLanguage = inferObjectLanguage(metadataRecord);
        if (nestedLanguage) {
            return nestedLanguage;
        }
    }
    return '';
};
const looksLikeCodeBlock = (value) => {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
        return false;
    }
    return (normalizedValue.includes('\n') ||
        /[{};<>]/.test(normalizedValue) ||
        normalizedValue.includes('=>') ||
        normalizedValue.includes('def ') ||
        normalizedValue.includes('class ') ||
        normalizedValue.includes('function ') ||
        normalizedValue.includes('import ') ||
        normalizedValue.includes('SELECT ') ||
        normalizedValue.includes('<?xml'));
};
const shouldRenderAsCodeBlock = (value, language, contentType) => {
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
const wrapCodeFence = (value, language) => {
    const normalizedValue = value.trim();
    const normalizedLanguage = normalizeCodeLanguage(language);
    const escapedValue = normalizedLanguage === 'html'
        ? escapeHtmlEntities(normalizedValue)
        : normalizedValue;
    return `\`\`\`${normalizedLanguage}\n${escapedValue}\n\`\`\``;
};
const collectRecordStrings = (record, keys) => keys.flatMap((key) => {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
        return [value];
    }
    if (Array.isArray(value)) {
        return value.filter((entry) => typeof entry === 'string' && !!entry.trim());
    }
    return [];
});
const collectStringLeaves = (value, visited = new WeakSet()) => {
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
    return Object.values(value).flatMap((entry) => collectStringLeaves(entry, visited));
};
const isLikelyImageKey = (key) => IMAGE_CONTENT_HINT_PATTERN.test(key);
const normalizeRenderableImageUrl = (value) => {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
        return '';
    }
    if (trimmedValue.startsWith('//')) {
        return `https:${trimmedValue}`;
    }
    return trimmedValue;
};
const isRenderableImageUrl = (value) => IMAGE_URL_PATTERN.test(normalizeRenderableImageUrl(value));
const isLikelyImageContext = (record, parentContext) => {
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
    if (mimeTypeCandidates.some((candidate) => typeof candidate === 'string' &&
        IMAGE_MIME_TYPE_PATTERN.test(candidate.trim().toLowerCase()))) {
        return true;
    }
    return Object.keys(record).some((key) => isLikelyImageKey(key));
};
const collectImageParts = (value, parentContext = false, visited = new WeakSet()) => {
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
    const record = value;
    const imageContext = isLikelyImageContext(record, parentContext);
    const imageParts = [];
    Object.entries(record).forEach(([key, entry]) => {
        if (typeof entry === 'string') {
            const normalizedEntry = normalizeRenderableImageUrl(entry);
            if (isRenderableImageUrl(normalizedEntry) && (imageContext || isLikelyImageKey(key))) {
                imageParts.push(`![image](${normalizedEntry})`);
                return;
            }
            const pointerMatch = normalizedEntry.match(FILE_SERVICE_POINTER_PATTERN);
            if (pointerMatch?.[1] &&
                (imageContext || isLikelyImageKey(key) || key === 'asset_pointer')) {
                imageParts.push(`[이미지 첨부: ${pointerMatch[1]}]`);
            }
            return;
        }
        imageParts.push(...collectImageParts(entry, imageContext || isLikelyImageKey(key), visited));
    });
    return imageParts;
};
const chooseBestCodeCandidate = (candidates, language, contentType) => {
    const sanitizedCandidates = candidates
        .map((candidate) => candidate.trim())
        .filter((candidate) => !!candidate &&
        !LANGUAGE_ONLY_PATTERN.test(candidate) &&
        !MERMAID_LOADING_TEXT_PATTERN.test(candidate) &&
        !HTTP_HEADER_CODE_PATTERN.test(candidate));
    if (language === 'mermaid') {
        return (sanitizedCandidates.find((candidate) => MERMAID_SOURCE_PATTERN.test(candidate)) ??
            '');
    }
    return (sanitizedCandidates.find((candidate) => shouldRenderAsCodeBlock(candidate, language, contentType)) ??
        sanitizedCandidates.sort((left, right) => right.length - left.length)[0] ??
        '');
};
const renderConversationPart = (value) => {
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
    const record = value;
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
    const deepLeafCandidates = language || /code|source|snippet|svg|diagram/i.test(contentType)
        ? collectStringLeaves(record)
        : [];
    const codeCandidate = chooseBestCodeCandidate([...primaryCodeCandidates, ...deepLeafCandidates], language, contentType);
    if (codeCandidate) {
        return [wrapCodeFence(codeCandidate, language || 'text')];
    }
    const imageParts = collectImageParts(record);
    if (imageParts.length > 0) {
        return [...new Set(imageParts)];
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
    const uniqueParts = [];
    nestedParts.forEach((part) => {
        if (part && uniqueParts[uniqueParts.length - 1] !== part) {
            uniqueParts.push(part);
        }
    });
    return uniqueParts;
};
const extractLargestRscPayload = (html) => {
    const matches = [
        ...html.matchAll(/streamController\.enqueue\("([\s\S]*?)"\);<\/script>/g),
    ];
    if (matches.length === 0) {
        return null;
    }
    return (matches.sort((left, right) => right[1].length - left[1].length)[0]?.[1] ??
        null);
};
const containsDeepResearchPayloadText = (value) => {
    if (typeof value === 'string') {
        return (isDeepResearchSteerPayloadText(value) ||
            isWidgetStatePayloadText(value) ||
            value.includes(WIDGET_STATE_MARKER));
    }
    if (Array.isArray(value)) {
        return value.some((entry) => containsDeepResearchPayloadText(entry));
    }
    if (!value || typeof value !== 'object') {
        return false;
    }
    return Object.values(value).some((entry) => containsDeepResearchPayloadText(entry));
};
const getOrderedMappingNodes = (conversation) => {
    if (!conversation.mapping || !conversation.current_node) {
        return [];
    }
    const orderedNodes = [];
    const visitedNodeIds = new Set();
    let currentNodeId = conversation.current_node;
    while (currentNodeId &&
        !visitedNodeIds.has(currentNodeId) &&
        conversation.mapping[currentNodeId]) {
        visitedNodeIds.add(currentNodeId);
        orderedNodes.push(conversation.mapping[currentNodeId]);
        currentNodeId = conversation.mapping[currentNodeId].parent ?? null;
    }
    orderedNodes.reverse();
    return orderedNodes;
};
const buildReportAssistantMessages = (payload, fallbackUrl, seenFingerprints) => buildReportMessageConversations(payload, fallbackUrl)
    .map((conversation) => getReportAssistantMessage(conversation))
    .filter((message) => !!message)
    .filter((message) => {
    const fingerprint = message.text.trim();
    if (!fingerprint || seenFingerprints.has(fingerprint)) {
        return false;
    }
    seenFingerprints.add(fingerprint);
    return true;
})
    .map((message) => ({
    ...message,
    sources: [...message.sources],
}));
const buildRenderedMappingMessage = (node) => {
    const message = node.message;
    const role = message?.author?.role;
    const contentType = message?.content?.content_type;
    const metadataImageParts = collectImageParts(message?.metadata ?? {});
    const text = normalizeMessageText([...renderConversationPart(message?.content), ...metadataImageParts].join('\n\n'));
    const metadata = message?.metadata ?? {};
    if ((role !== 'assistant' && role !== 'user') ||
        (contentType && NON_IMPORTABLE_CONTENT_TYPES.has(contentType)) ||
        (message?.status && message.status !== 'finished_successfully') ||
        !text ||
        metadata.is_visually_hidden_from_conversation === true ||
        metadata.is_redacted === true ||
        metadata.reasoning_status === 'is_reasoning') {
        return null;
    }
    return {
        role,
        sources: [],
        text,
    };
};
const buildMappingNodeDescriptors = (conversation, fallbackUrl) => {
    const seenReportFingerprints = new Set();
    return getOrderedMappingNodes(conversation).map((node) => {
        const message = node.message;
        return {
            isDeepResearchPlaceholder: message?.author?.role === 'assistant' &&
                containsDeepResearchPayloadText(message?.content),
            renderedMessage: buildRenderedMappingMessage(node),
            reportAssistantMessages: buildReportAssistantMessages({
                content: message?.content,
                metadata: message?.metadata,
            }, fallbackUrl, seenReportFingerprints),
        };
    });
};
const buildConversationFromMapping = (conversation, fallbackUrl, reportMessageConversations) => {
    const descriptors = buildMappingNodeDescriptors(conversation, fallbackUrl);
    if (descriptors.length === 0) {
        return null;
    }
    const placeholderIndices = descriptors
        .map((descriptor, index) => descriptor.isDeepResearchPlaceholder ? index : -1)
        .filter((index) => index >= 0);
    const remainingPlaceholderIndices = [...placeholderIndices];
    const assignedReportsByPlaceholder = new Map();
    const extraReportsByNode = new Map();
    descriptors.forEach((descriptor, descriptorIndex) => {
        descriptor.reportAssistantMessages.forEach((reportAssistantMessage) => {
            let placeholderListIndex = -1;
            for (let index = remainingPlaceholderIndices.length - 1; index >= 0; index -= 1) {
                if (remainingPlaceholderIndices[index] <= descriptorIndex) {
                    placeholderListIndex = index;
                    break;
                }
            }
            if (placeholderListIndex < 0 && remainingPlaceholderIndices.length > 0) {
                placeholderListIndex = 0;
            }
            if (placeholderListIndex >= 0) {
                const placeholderIndex = remainingPlaceholderIndices.splice(placeholderListIndex, 1)[0];
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
    const seenRenderedReportFingerprints = new Set();
    const remainingGlobalReports = reportMessageConversations
        .map((conversationCandidate) => getReportAssistantMessage(conversationCandidate))
        .filter((message) => !!message)
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
        const trailingReports = extraReportsByNode.get(descriptors.length - 1) ?? [];
        trailingReports.push(reportAssistantMessage);
        extraReportsByNode.set(descriptors.length - 1, trailingReports);
    });
    const messages = [];
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
    const bestReportConversation = [...reportMessageConversations].sort((left, right) => scoreConversation(right) - scoreConversation(left))[0] ?? null;
    return {
        messages,
        sourceUrl: fallbackUrl,
        summary: bestReportConversation &&
            bestReportConversation.summary.length > messages[0].text.length
            ? bestReportConversation.summary
            : messages[0].text.replace(/\n/g, ' ').slice(0, 80),
        title: sanitizeConversationTitle(conversation.title ?? 'ChatGPT 대화'),
    };
};
const extractEmbeddedWidgetState = (value) => {
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
            }
            else if (character === '\\') {
                isEscaped = true;
            }
            else if (character === '"') {
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
                    return JSON.parse(value.slice(objectStartIndex, index + 1));
                }
                catch {
                    return null;
                }
            }
        }
    }
    return null;
};
const extractWidgetStatePayload = (value, depth = 0) => {
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
    const record = value;
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
const isWidgetStatePayloadText = (value) => !!extractWidgetStatePayload(value);
const buildConversationFromReportMessage = (reportMessage, fallbackUrl, title) => {
    const author = reportMessage.author;
    const authorRole = author && typeof author === 'object'
        ? author.role
        : undefined;
    const content = reportMessage.content;
    const contentType = content && typeof content === 'object'
        ? content.content_type
        : undefined;
    const parts = content && typeof content === 'object'
        ? renderConversationPart(content.parts ?? content)
        : [];
    const text = normalizeMessageText(parts.join('\n\n'));
    const normalizedTitle = sanitizeConversationTitle(extractHeadingTitle(text) ?? title ?? 'Deep Research 결과');
    if (authorRole !== 'assistant' || contentType !== 'text' || !text) {
        return null;
    }
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
        title: normalizedTitle,
    };
};
const getReportAssistantMessage = (conversation) => [...conversation.messages]
    .reverse()
    .find((message) => message.role === 'assistant' && message.text.trim().length > 0) ?? null;
const buildReportMessageConversations = (payload, fallbackUrl) => {
    const seenFingerprints = new Set();
    return collectReportMessageCandidates(payload)
        .map((candidate) => buildConversationFromReportMessage(candidate.reportMessage, fallbackUrl, candidate.title))
        .filter((candidate) => !!candidate)
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
const buildConversationFromReportMessages = (reportMessageConversations, fallbackUrl) => {
    const reportAssistantMessages = reportMessageConversations
        .map((conversation) => getReportAssistantMessage(conversation))
        .filter((message) => !!message);
    if (reportAssistantMessages.length === 0) {
        return null;
    }
    const bestConversation = [...reportMessageConversations].sort((left, right) => scoreConversation(right) - scoreConversation(left))[0] ?? null;
    return {
        messages: reportAssistantMessages.map((message) => ({
            ...message,
            sources: [...message.sources],
        })),
        sourceUrl: fallbackUrl,
        summary: bestConversation?.summary ??
            reportAssistantMessages[0].text.replace(/\n/g, ' ').slice(0, 80),
        title: bestConversation?.title ??
            sanitizeConversationTitle('Deep Research 결과'),
    };
};
const findConversationRoot = (value) => {
    const queue = [value];
    const visited = new WeakSet();
    while (queue.length > 0) {
        const current = queue.shift();
        if (!current || typeof current !== 'object') {
            continue;
        }
        if (visited.has(current)) {
            continue;
        }
        visited.add(current);
        const record = current;
        if (typeof record.current_node === 'string' &&
            record.mapping &&
            typeof record.mapping === 'object') {
            return record;
        }
        Object.values(record).forEach((entry) => {
            if (entry && typeof entry === 'object') {
                queue.push(entry);
            }
        });
    }
    return null;
};
const collectReportMessageCandidates = (payload) => {
    const queue = [
        { value: payload, title: null },
    ];
    const visited = new WeakSet();
    const widgetStateFingerprints = new Set();
    const reportMessageFingerprints = new Set();
    const candidates = [];
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
        const record = value;
        const plan = record.plan;
        const nextTitle = typeof record.title === 'string'
            ? record.title
            : plan &&
                typeof plan === 'object' &&
                typeof plan.title === 'string'
                ? (plan.title ?? null)
                : title;
        if (record.report_message && typeof record.report_message === 'object') {
            const fingerprint = JSON.stringify(record.report_message);
            if (!reportMessageFingerprints.has(fingerprint)) {
                reportMessageFingerprints.add(fingerprint);
                candidates.push({
                    reportMessage: record.report_message,
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
const parseChatGptConversationJsonPayload = (payload, fallbackUrl) => {
    const reportMessageConversations = buildReportMessageConversations(payload, fallbackUrl);
    const mappingConversation = (() => {
        const conversationRoot = findConversationRoot(payload);
        if (!conversationRoot) {
            return null;
        }
        return buildConversationFromMapping(conversationRoot, fallbackUrl, reportMessageConversations);
    })();
    if (mappingConversation) {
        return mappingConversation;
    }
    return (buildConversationFromReportMessages(reportMessageConversations, fallbackUrl) ??
        mappingConversation);
};
exports.parseChatGptConversationJsonPayload = parseChatGptConversationJsonPayload;
const parseJsonConversationBody = (text, fallbackUrl) => {
    const candidates = [text.trim(), text.trim().replace(/^for\s*\(;;\);\s*/, '')];
    for (const candidate of candidates) {
        if (!candidate) {
            continue;
        }
        try {
            const parsed = JSON.parse(candidate);
            const conversation = (0, exports.parseChatGptConversationJsonPayload)(parsed, fallbackUrl);
            if (conversation) {
                return conversation;
            }
        }
        catch {
            // Ignore JSON parse failures and continue with other parsers.
        }
    }
    return null;
};
const parseWidgetStateConversationBody = (text, fallbackUrl) => {
    const widgetStatePayload = extractWidgetStatePayload(text);
    if (!widgetStatePayload) {
        return null;
    }
    const parsedConversation = (0, exports.parseChatGptConversationJsonPayload)(widgetStatePayload, fallbackUrl);
    if (parsedConversation) {
        return parsedConversation;
    }
    return buildConversationFromReportMessages(buildReportMessageConversations(widgetStatePayload, fallbackUrl), fallbackUrl);
};
const parseChatGptConversationBodyText = (text, fallbackUrl) => {
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
exports.parseChatGptConversationBodyText = parseChatGptConversationBodyText;
const parseRscConversationBody = (text, fallbackUrl) => {
    const rawPayload = extractLargestRscPayload(text);
    if (!rawPayload) {
        return null;
    }
    try {
        const decodedPayload = decodeRscPayload(rawPayload);
        const payload = JSON.parse(decodedPayload);
        const mappingKeyIndex = payload.indexOf('mapping');
        const currentNodeKeyIndex = payload.indexOf('current_node');
        const titleKeyIndex = payload.indexOf('title');
        const rootObject = payload.find((entry) => !!entry &&
            typeof entry === 'object' &&
            !Array.isArray(entry) &&
            mappingKeyIndex >= 0 &&
            currentNodeKeyIndex >= 0 &&
            titleKeyIndex >= 0 &&
            `_${mappingKeyIndex}` in entry &&
            `_${currentNodeKeyIndex}` in entry &&
            `_${titleKeyIndex}` in entry);
        if (!rootObject) {
            return null;
        }
        const resolvedIndexCache = new Map();
        const resolveValue = (value) => {
            if (Array.isArray(value)) {
                return value.map((item) => resolveReference(item));
            }
            if (!value || typeof value !== 'object') {
                return value;
            }
            const record = value;
            const resolvedRecord = {};
            Object.entries(record).forEach(([key, entryValue]) => {
                if (key.startsWith('_') && /^_\d+$/.test(key)) {
                    const resolvedKey = payload[Number(key.slice(1))];
                    if (typeof resolvedKey === 'string') {
                        resolvedRecord[resolvedKey] = resolveReference(entryValue);
                    }
                }
                else {
                    resolvedRecord[key] = resolveValue(entryValue);
                }
            });
            return resolvedRecord;
        };
        const resolveReference = (value) => {
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
        const conversation = resolveValue(rootObject);
        const reportMessageConversations = buildReportMessageConversations(conversation, fallbackUrl);
        return buildConversationFromMapping(conversation, fallbackUrl, reportMessageConversations);
    }
    catch {
        return null;
    }
};
const parseHtmlConversationBody = (text, fallbackUrl) => {
    if (!/<html[\s\S]*?<body/i.test(text) && !/<main[\s\S]*?<\/main>/i.test(text)) {
        return null;
    }
    const htmlConversation = (0, chatGptConversationHtmlParser_1.parseChatGptConversationDocumentHtml)(text, fallbackUrl);
    if (htmlConversation) {
        return htmlConversation;
    }
    const scriptContents = [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
    const nextFlightChunks = scriptContents.flatMap((scriptContent) => [...scriptContent.matchAll(/__next_f\.push\(\s*\[\s*\d+\s*,\s*"([\s\S]*?)"\s*\]\s*\)/g)]
        .map((match) => match[1])
        .map((payload) => {
        try {
            return decodeRscPayload(payload);
        }
        catch {
            return '';
        }
    })
        .filter(Boolean));
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
const isLikelyConversationBody = (record) => {
    const normalizedUrl = record.url.toLowerCase();
    const normalizedMimeType = (record.mimeType || '').toLowerCase();
    return (normalizedUrl.includes('/backend-api/') ||
        normalizedUrl.includes('/conversation') ||
        normalizedMimeType.includes('json') ||
        normalizedMimeType.includes('html') ||
        normalizedMimeType.includes('x-component'));
};
const scoreConversation = (conversation) => {
    const totalLength = conversation.messages.reduce((sum, message) => sum + message.text.length, 0);
    const fencedCodeBlocks = conversation.messages.reduce((sum, message) => sum + (message.text.match(LANGUAGE_FENCE_PATTERN)?.length ?? 0), 0);
    const mermaidBlocks = conversation.messages.reduce((sum, message) => sum + (message.text.match(/```mermaid\n[\s\S]*?```/g)?.length ?? 0), 0);
    return (conversation.messages.length * 1_000 +
        totalLength +
        fencedCodeBlocks * 2_500 +
        mermaidBlocks * 5_000);
};
const buildRecordCandidates = (records, fallbackUrl) => {
    const relevantRecords = records
        .filter((record) => record.status >= 200 && record.status < 300)
        .filter(isLikelyConversationBody)
        .slice()
        .reverse();
    const candidates = [];
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
const countMermaidSignals = (value) => {
    const matches = value.match(MERMAID_SOURCE_PATTERN);
    return matches ? matches.length : 0;
};
const trimDiagnosticUrl = (value) => {
    try {
        const url = new URL(value);
        return `${url.origin}${url.pathname}`;
    }
    catch {
        return value;
    }
};
const extractDiagnosticSnippet = (value) => {
    const signalMatch = value.match(/(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|xychart-beta|xychart|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|requirementDiagram|block-beta|architecture-beta|subgraph|-->)/i) ??
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
const buildChatGptConversationNetworkDiagnostics = (records, fallbackUrl) => {
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
        lines.push(`record[${index + 1}]: status=${record.status} type=${record.resourceType || 'Other'} mime=${record.mimeType || '-'} url=${trimDiagnosticUrl(record.url)} body=${record.bodyText.length} mermaidSignals=${mermaidSignalCount} candidates=${recordCandidates.length}${bestRecordCandidate ? ` best=${bestRecordCandidate.parser}:${bestRecordCandidate.score}:messages=${bestRecordCandidate.conversation.messages.length}` : ''}`);
        if (mermaidSignalCount > 0 && !bestRecordCandidate) {
            const diagnosticSnippet = extractDiagnosticSnippet(record.bodyText);
            if (diagnosticSnippet) {
                lines.push(`record[${index + 1}]-snippet: ${diagnosticSnippet}`);
            }
        }
    });
    if (selectedCandidate) {
        const mermaidBlocks = selectedCandidate.conversation.messages.reduce((sum, message) => sum + (message.text.match(/```mermaid\n[\s\S]*?```/g)?.length ?? 0), 0);
        const fencedBlocks = selectedCandidate.conversation.messages.reduce((sum, message) => sum + (message.text.match(LANGUAGE_FENCE_PATTERN)?.length ?? 0), 0);
        lines.push(`selected: parser=${selectedCandidate.parser} score=${selectedCandidate.score} url=${trimDiagnosticUrl(selectedCandidate.record.url)} messages=${selectedCandidate.conversation.messages.length} fenced=${fencedBlocks} mermaid=${mermaidBlocks}`);
    }
    else {
        lines.push('selected: none');
    }
    return lines.join('\n');
};
exports.buildChatGptConversationNetworkDiagnostics = buildChatGptConversationNetworkDiagnostics;
const parseChatGptConversationNetworkRecords = (records, fallbackUrl) => {
    const bestCandidate = buildRecordCandidates(records, fallbackUrl)
        .sort((left, right) => right.score - left.score)[0];
    return bestCandidate?.conversation ?? null;
};
exports.parseChatGptConversationNetworkRecords = parseChatGptConversationNetworkRecords;
