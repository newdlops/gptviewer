import type { ConversationCandidate, ReportMessageCandidate } from './types';
import type { SharedConversationMessage } from '../../../shared/refresh/sharedConversationRefresh';
import {
  WIDGET_STATE_MARKER,
} from './constants';
import {
  tryParseJsonRecord,
  isDeepResearchSteerPayloadText,
  renderConversationPart,
  normalizeMessageText,
  extractHeadingTitle,
  sanitizeConversationTitle,
} from './utils';
import { extractMessageSourcesFromMetadata } from './messageBuilder';

/**
 * 문자열 내에 포함된 위젯 상태(WIDGET_STATE_MARKER 뒤의 JSON 객체)를 추출합니다.
 * 
 * @param value 분석할 문자열
 * @returns 추출된 위젯 상태 객체 또는 null
 */
export const extractEmbeddedWidgetState = (value: string): unknown | null => {
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

  // JSON 객체의 끝(})을 찾기 위한 괄호 밸런싱 루프
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

/**
 * 데이터 구조 내에서 위젯 상태 페이로드를 재귀적으로 탐색하여 추출합니다.
 * 
 * @param value 탐색할 데이터
 * @param depth 현재 재귀 깊이
 * @returns 추출된 위젯 상태 레코드 또는 null
 */
export const extractWidgetStatePayload = (
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

/**
 * 텍스트 내용이 위젯 상태 페이로드를 포함하고 있는지 여부를 확인합니다.
 * 
 * @param value 확인할 텍스트
 * @returns 포함 여부
 */
export const isWidgetStatePayloadText = (value: string): boolean =>
  !!extractWidgetStatePayload(value);

/**
 * 데이터 구조 내에 Deep Research 관련 페이로드(제어 텍스트 또는 위젯 상태)가 포함되어 있는지 확인합니다.
 * 
 * @param value 확인할 데이터
 * @returns 포함 여부
 */
export const containsDeepResearchPayloadText = (value: unknown): boolean => {
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

/**
 * 페이로드 전체를 훑으며 'report_message'가 포함된 모든 후보들을 수집합니다.
 * 
 * @param payload 탐색할 루트 페이로드
 * @returns 수집된 보고서 메시지 후보 배열
 */
export const collectReportMessageCandidates = (payload: unknown): ReportMessageCandidate[] => {
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

/**
 * 개별 보고서 메시지 데이터로부터 대화 후보(ConversationCandidate) 객체를 빌드합니다.
 * 
 * @param reportMessage 보고서 메시지 레코드
 * @param fallbackUrl 소스 URL
 * @param title 기본 제목
 * @returns 빌드된 대화 후보 객체 또는 null
 */
export const buildConversationFromReportMessage = (
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
  
  // 콘텐츠 참조 치환
  if (Array.isArray(metadata.content_references)) {
      for (const ref of metadata.content_references) {
          if (ref.matched_text && typeof ref.matched_text === 'string') {
              let replacement = ref.alt;
              if (typeof replacement === 'string') {
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
  // 텍스트 내의 제목(# )을 우선적으로 제목으로 사용
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

/**
 * 대화 후보로부터 어시스턴트 역할의 메시지를 추출합니다.
 * 
 * @param candidate 대화 후보 객체
 * @returns 추출된 메시지 또는 null
 */
export const getReportAssistantMessage = (
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

/**
 * 페이로드 내의 모든 보고서 메시지를 찾아 대화 후보 리스트를 빌드합니다.
 * 중복된 보고서는 필터링합니다.
 * 
 * @param payload 분석할 페이로드
 * @param fallbackUrl 소스 URL
 * @returns 빌드된 대화 후보 배열
 */
export const buildReportMessageConversations = (
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
