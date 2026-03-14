import type {
  ConversationCandidate,
  MappingConversation,
} from './types';
import type { SharedConversationMessage } from '../../../shared/refresh/sharedConversationRefresh';
import { sanitizeConversationTitle } from './utils';
import { getReportAssistantMessage } from './widgetParser';
import { buildMappingNodeDescriptors } from './mappingParser';

/**
 * 대화의 품질을 로컬에서 점수화합니다.
 * 메시지 수, 전체 텍스트 길이, 코드 블록 및 Mermaid 블록의 개수를 기반으로 가중치를 부여하여 계산합니다.
 * 
 * @param messages 점수를 계산할 메시지 배열
 * @returns 계산된 대화 점수
 */
const scoreConversationLocally = (messages: SharedConversationMessage[]): number => {
  const totalLength = messages.reduce((sum, message) => sum + message.text.length, 0);
  const fencedCodeBlocks = messages.reduce(
    (sum, message) => sum + (message.text.match(/```([\w#+.-]+)?\n[\s\S]*?```/g)?.length ?? 0),
    0,
  );
  const mermaidBlocks = messages.reduce(
    (sum, message) => sum + (message.text.match(/```mermaid\n[\s\S]*?```/g)?.length ?? 0),
    0,
  );

  return (
    messages.length * 1_000 +
    totalLength +
    fencedCodeBlocks * 2_500 +
    mermaidBlocks * 5_000
  );
};

/**
 * Mapping 대화 데이터를 바탕으로 최종 대화(ConversationCandidate) 객체를 빌드합니다.
 * Deep Research 자리 표시자(placeholder)를 처리하고, 관련 보고서 메시지들을 적절한 위치에 할당합니다.
 * 
 * @param conversation 매핑된 대화 데이터
 * @param fallbackUrl 소스 URL
 * @param reportMessageConversations 보고서 메시지를 포함하는 대화 후보군
 * @param buildReportAssistantMessages 보고서 메시지를 빌드하는 콜백 함수
 * @returns 빌드된 대화 후보 객체 또는 null
 */
export const buildConversationFromMapping = (
  conversation: MappingConversation,
  fallbackUrl: string,
  reportMessageConversations: ConversationCandidate[],
  buildReportAssistantMessages: (
    payload: unknown,
    fallbackUrl: string,
    seenFingerprints: Set<string>,
  ) => SharedConversationMessage[],
): ConversationCandidate | null => {
  const descriptors = buildMappingNodeDescriptors(conversation, fallbackUrl, buildReportAssistantMessages);
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

  // 노드별 기술자(descriptors)를 순회하며 보고서 메시지를 적절한 자리 표시자나 노드에 할당
  descriptors.forEach((descriptor, descriptorIndex) => {
    descriptor.reportAssistantMessages.forEach((reportAssistantMessage) => {
      let placeholderListIndex = -1;

      // 현재 노드 위치보다 앞에 있는 가장 가까운 자리 표시자를 찾음
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
  // 아직 할당되지 않은 전역 보고서 메시지들을 필터링 및 정리
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

  // 남은 전역 보고서들을 자리 표시자나 마지막 노드에 추가
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

  // 최종 메시지 배열 구성
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

  // 가장 품질이 좋은 보고서 대화를 선택하여 요약 정보로 활용
  const bestReportConversation =
    [...reportMessageConversations].sort(
      (left, right) => scoreConversationLocally(right.messages) - scoreConversationLocally(left.messages),
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

/**
 * 보고서 메시지들만으로 대화 후보 객체를 빌드합니다.
 * 매핑 정보가 없는 경우 등에 사용됩니다.
 * 
 * @param reportMessageConversations 보고서 메시지를 포함하는 대화 후보군
 * @param fallbackUrl 소스 URL
 * @returns 빌드된 대화 후보 객체 또는 null
 */
export const buildConversationFromReportMessages = (
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
      (left, right) => scoreConversationLocally(right.messages) - scoreConversationLocally(left.messages),
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
