import type {
  SharedConversationImport,
} from '../../shared/refresh/sharedConversationRefresh';
import type { ChatGptConversationNetworkRecord } from '../services/sharedConversationRefresh/chatgpt/chatGptConversationNetworkMonitor';
import { parseChatGptConversationDocumentHtml } from './chatGptConversationHtmlParser';
import type { ConversationCandidate, ConversationMappingNode, MappingConversation, RecordConversationCandidate } from './chatgpt/types';
import { MERMAID_SOURCE_PATTERN, LANGUAGE_FENCE_PATTERN } from './chatgpt/constants';
import { decodeRscPayload } from './chatgpt/utils';
import { extractWidgetStatePayload, buildReportMessageConversations } from './chatgpt/widgetParser';
import { buildConversationFromMapping, buildConversationFromReportMessages } from './chatgpt/conversationBuilder';
import { findConversationRoot } from './chatgpt/rootFinder';

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
      (p, url, seen) => {
         // To avoid circular dependency, we inline the call to buildReportMessageConversations here
         // and extract the assistant message.
         // Wait, the original code had this logic. It's better to pass it.
         return buildReportMessageConversations(p, url)
           .map((candidate) => {
             const msg = candidate.messages.find((m) => m.role === 'assistant');
             return msg ? { authorName: msg.authorName, role: 'assistant' as const, sources: msg.sources || [], text: msg.text } : null;
           })
           .filter((m): m is NonNullable<typeof m> => !!m)
           .filter((message) => {
             const fingerprint = message.text.trim();
             if (!fingerprint || seen.has(fingerprint)) return false;
             seen.add(fingerprint);
             return true;
           });
      }
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

  if (currentNodeId && mapping[currentNodeId]) {
      mapping[currentNodeId].message!.status = 'finished_successfully';
  }

  if (Object.keys(mapping).length > 0 && currentNodeId) {
    return parseChatGptConversationJsonPayload(
      { mapping, current_node: currentNodeId, title },
      fallbackUrl
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
      if (!candidate) continue;
      try {
        const parsed = JSON.parse(candidate) as unknown;
        const conversation = parseChatGptConversationJsonPayload(parsed, fallbackUrl);
        if (conversation) return conversation;
      } catch {
        // Ignore JSON parse failures
      }
    }
    return null;
  })();

  if (jsonConversation) return jsonConversation;
  return parseSseConversationBody(text, fallbackUrl);
};

const parseWidgetStateConversationBody = (
  text: string,
  fallbackUrl: string,
): ConversationCandidate | null => {
  const widgetStatePayload = extractWidgetStatePayload(text);
  if (!widgetStatePayload) return null;

  const parsedConversation = parseChatGptConversationJsonPayload(widgetStatePayload, fallbackUrl);
  if (parsedConversation) return parsedConversation;

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
  if (jsonConversation) return jsonConversation;

  const widgetConversation = parseWidgetStateConversationBody(text, fallbackUrl);
  if (widgetConversation) return widgetConversation;

  const rscConversation = parseRscConversationBody(text, fallbackUrl);
  if (rscConversation) return rscConversation;

  return parseHtmlConversationBody(text, fallbackUrl);
};

const parseRscConversationBody = (
  text: string,
  fallbackUrl: string,
): ConversationCandidate | null => {
  const matches = [...text.matchAll(/streamController\.enqueue\("([\s\S]*?)"\);<\/script>/g)];
  if (matches.length === 0) return null;

  const rawPayload = matches.sort((a, b) => b[1].length - a[1].length)[0]?.[1] ?? null;
  if (!rawPayload) return null;

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

    if (!rootObject) return null;

    const resolvedIndexCache = new Map<number, unknown>();

    const resolveValue = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map((item) => resolveReference(item));
      if (!value || typeof value !== 'object') return value;

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
        if (value < 0) return null;
        if (resolvedIndexCache.has(value)) return resolvedIndexCache.get(value);
        const resolved = resolveValue(payload[value]);
        resolvedIndexCache.set(value, resolved);
        return resolved;
      }
      return resolveValue(value);
    };

    const conversation = resolveValue(rootObject) as MappingConversation;
    return parseChatGptConversationJsonPayload(conversation, fallbackUrl);
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
  if (htmlConversation) return htmlConversation;

  const scriptContents = [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);

  const nextFlightChunks = scriptContents.flatMap((scriptContent) =>
    [...scriptContent.matchAll(/__next_f\.push\(\s*\[\s*\d+\s*,\s*"([\s\S]*?)"\s*\]\s*\)/g)]
      .map((match) => match[1])
      .map((p) => {
        try { return decodeRscPayload(p); } catch { return ''; }
      })
      .filter(Boolean),
  );

  const embeddedCandidates = [...scriptContents, ...nextFlightChunks];
  for (const candidate of embeddedCandidates) {
    const jsonConversation = parseJsonConversationBody(candidate, fallbackUrl);
    if (jsonConversation) return jsonConversation;

    const rscConversation = parseRscConversationBody(candidate, fallbackUrl);
    if (rscConversation) return rscConversation;
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
  const totalLength = conversation.messages.reduce((sum, message) => sum + message.text.length, 0);
  const fencedCodeBlocks = conversation.messages.reduce(
    (sum, message) => sum + (message.text.match(LANGUAGE_FENCE_PATTERN)?.length ?? 0),
    0,
  );
  const mermaidBlocks = conversation.messages.reduce(
    (sum, message) => sum + (message.text.match(/```mermaid\n[\s\S]*?```/g)?.length ?? 0),
    0,
  );

  return conversation.messages.length * 1_000 + totalLength + fencedCodeBlocks * 2_500 + mermaidBlocks * 5_000;
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
    if (jsonConversation) candidates.push({ conversation: jsonConversation, parser: 'json', record, score: scoreConversation(jsonConversation) });

    const rscConversation = parseRscConversationBody(record.bodyText, fallbackUrl);
    if (rscConversation) candidates.push({ conversation: rscConversation, parser: 'rsc', record, score: scoreConversation(rscConversation) });

    const htmlConversation = parseHtmlConversationBody(record.bodyText, fallbackUrl);
    if (htmlConversation) candidates.push({ conversation: htmlConversation, parser: 'html', record, score: scoreConversation(htmlConversation) });
  });

  return candidates;
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
  const selectedCandidate = candidates.slice().sort((left, right) => right.score - left.score)[0];

  const lines = [
    `network-records: total=${records.length} relevant=${relevantRecords.length} candidates=${candidates.length}`,
  ];

  relevantRecords.forEach((record, index) => {
    const recordCandidates = candidates.filter((candidate) => candidate.record === record);
    const bestRecordCandidate = recordCandidates.slice().sort((left, right) => right.score - left.score)[0];
    const mermaidSignalCount = (record.bodyText.match(MERMAID_SOURCE_PATTERN) || []).length;

    lines.push(
      `record[${index + 1}]: status=${record.status} type=${record.resourceType || 'Other'} mime=${record.mimeType || '-'} url=${record.url} body=${record.bodyText.length} mermaidSignals=${mermaidSignalCount} candidates=${recordCandidates.length}${bestRecordCandidate ? ` best=${bestRecordCandidate.parser}:${bestRecordCandidate.score}:messages=${bestRecordCandidate.conversation.messages.length}` : ''}`,
    );
  });

  if (selectedCandidate) {
    lines.push(
      `selected: parser=${selectedCandidate.parser} score=${selectedCandidate.score} messages=${selectedCandidate.conversation.messages.length}`,
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
