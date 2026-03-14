import type { SharedConversationMessage, SharedConversationSource } from '../../../shared/refresh/sharedConversationRefresh';
import type { ConversationMappingNode } from './types';
import { NON_IMPORTABLE_CONTENT_TYPES } from './constants';
import { renderConversationPart, collectImageParts, normalizeMessageText } from './utils';

/**
 * 메시지 메타데이터로부터 출처(sources) 정보를 추출합니다.
 * 검색 결과 그룹(search_result_groups) 및 콘텐츠 참조(content_references)를 분석합니다.
 * 
 * @param metadata 메시지 메타데이터
 * @returns 추출된 출처 정보 배열
 */
export const extractMessageSourcesFromMetadata = (metadata: Record<string, any>): SharedConversationSource[] => {
  const sources: SharedConversationSource[] = [];
  const dedup = new Set<string>();

  const addSource = (url: string, title: string, attribution?: string, description?: string) => {
    if (!url || dedup.has(url)) return;
    dedup.add(url);
    sources.push({ url, title, attribution, description });
  };

  // 검색 결과 분석
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

  // 콘텐츠 참조 분석
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

/**
 * 매핑 노드로부터 렌더링된 메시지 객체(SharedConversationMessage)를 빌드합니다.
 * 역할(role) 결정, 이미지 포함 여부 확인, 텍스트 정규화 및 가시성 필터링을 수행합니다.
 * 
 * @param node 분석할 매핑 노드
 * @returns 빌드된 메시지 객체 또는 필터링된 경우 null
 */
export const buildRenderedMappingMessage = (
  node: ConversationMappingNode,
): SharedConversationMessage | null => {
  const message = node.message;
  const rawRole = message?.author?.role;
  const contentType = message?.content?.content_type;
  const contentParts = renderConversationPart(message?.content);
  const metadataImageParts = collectImageParts(message?.metadata ?? {});
  const hasImagePayload =
    collectImageParts(message?.content).length > 0 || metadataImageParts.length > 0;
  // 도구(tool) 역할이라도 이미지가 포함되어 있다면 assistant 메시지로 취급
  const role = rawRole === 'tool' && hasImagePayload ? 'assistant' : rawRole;
  const metadata = message?.metadata ?? {};

  let rawText = [...contentParts, ...metadataImageParts].join('\n\n');
  
  // 콘텐츠 참조(출처 표시 등)를 텍스트 내에서 적절한 링크로 치환
  if (Array.isArray(metadata.content_references)) {
      for (const ref of metadata.content_references) {
          if (ref.matched_text && typeof ref.matched_text === 'string') {
              let replacement = ref.alt;
              if (typeof replacement === 'string') {
                  // 괄호 제거 등의 정규화
                  replacement = replacement.trim().replace(/^\((.+)\)$/, '$1').trim();
              }
              
              if (!replacement && Array.isArray(ref.items) && ref.items.length > 0) {
                 replacement = `[${ref.items[0].title || ref.items[0].attribution || '출처'}](${ref.items[0].url})`;
              } else if (!replacement && Array.isArray(ref.sources) && ref.sources.length > 0) {
                 replacement = `[${ref.sources[0].title || ref.sources[0].attribution || '출처'}](${ref.sources[0].url})`;
              }
              
              if (replacement) {
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

  // 다양한 가시성 및 유효성 조건에 따른 필터링
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

/**
 * 노드(메시지)에 이미지 데이터가 포함되어 있는지 확인합니다.
 * 
 * @param node 확인할 노드
 * @returns 이미지 포함 여부
 */
export const hasImagePayloadInNode = (node: ConversationMappingNode): boolean =>
  collectImageParts(node.message?.content).length > 0 ||
  collectImageParts(node.message?.metadata).length > 0;

/**
 * 메시지의 생성 시간을 반환합니다.
 * 생성 시간이 유효하지 않은 경우 무한대 값을 반환하여 가장 뒤로 밀리게 합니다.
 * 
 * @param node 확인할 노드
 * @returns 메시지 생성 시간(유닉스 타임스탬프)
 */
export const getMessageCreateTime = (node: ConversationMappingNode): number => {
  const createTime = node.message?.create_time;
  return typeof createTime === 'number' && Number.isFinite(createTime)
    ? createTime
    : Number.POSITIVE_INFINITY;
};
