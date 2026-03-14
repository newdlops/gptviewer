import type {
  ConversationCandidate,
  ConversationMappingNode,
  MappingConversation,
  MappingNodeDescriptor,
} from './types';
import type { SharedConversationMessage } from '../../../shared/refresh/sharedConversationRefresh';
import { containsDeepResearchPayloadText } from './widgetParser';
import { buildRenderedMappingMessage, getMessageCreateTime, hasImagePayloadInNode } from './messageBuilder';

/**
 * 대화의 매핑 노드들을 현재 활성화된 경로(current_node)를 기준으로 순서대로 정렬하여 반환합니다.
 * 루트 노드부터 현재 노드까지의 경로를 구성합니다.
 * 
 * @param conversation 매핑된 대화 데이터
 * @returns 정렬된 노드 ID와 노드 객체의 배열
 */
export const getOrderedMappingNodes = (
  conversation: MappingConversation,
): Array<{ id: string; node: ConversationMappingNode }> => {
  if (!conversation.mapping || !conversation.current_node) {
    return [];
  }

  const orderedNodes: Array<{ id: string; node: ConversationMappingNode }> = [];
  const visitedNodeIds = new Set<string>();
  let currentNodeId: string | null = conversation.current_node;

  // 현재 노드부터 부모를 타고 올라가며 방문
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

  // 역순으로 정렬하여 루트부터 시작하게 함
  orderedNodes.reverse();
  return orderedNodes;
};

/**
 * 매핑 노드 기술자(MappingNodeDescriptor) 배열을 빌드합니다.
 * 메시지 렌더링, Deep Research 자리 표시자 확인, 그리고 분리된(detached) 이미지 노드들을 적절한 위치에 병합합니다.
 * 
 * @param conversation 매핑된 대화 데이터
 * @param fallbackUrl 소스 URL
 * @param buildReportAssistantMessages 보고서 메시지를 빌드하는 콜백 함수
 * @returns 구성된 노드 기술자 배열
 */
export const buildMappingNodeDescriptors = (
  conversation: MappingConversation,
  fallbackUrl: string,
  buildReportAssistantMessages: (
    payload: unknown,
    fallbackUrl: string,
    seenFingerprints: Set<string>,
  ) => SharedConversationMessage[],
): MappingNodeDescriptor[] => {
  const seenReportFingerprints = new Set<string>();
  const orderedEntries = getOrderedMappingNodes(conversation);
  const orderedNodeIdToIndex = new Map<string, number>();
  orderedEntries.forEach((entry, index) => {
    orderedNodeIdToIndex.set(entry.id, index);
  });

  // 기본 활성 경로의 노드들에 대한 기술자 생성
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

  // 활성 경로에 포함되지 않았지만 이미지가 포함된 노드들을 찾아 적절한 부모 위치 근처에 배치
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

  // 분리된 노드들을 생성 시간 순으로 정렬
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

  // 최종적으로 기본 기술자와 분리된 노드들을 병합
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
