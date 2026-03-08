import type {
  ProjectConversationImportFailure,
  ProjectConversationImportProgress,
  ProjectConversationLink,
} from '../../../../shared/import/projectConversationImport';
import { decodeSharedConversationRefreshError } from '../../../../shared/refresh/sharedConversationRefreshErrorCodec';
import type { SharedConversationImport } from '../../../../shared/refresh/sharedConversationRefresh';
import { normalizeImportedConversation } from '../../conversations/lib/normalizers';
import type { Conversation } from '../../../types/chat';
import type { ProjectConversationImportStrategyPreference } from './projectConversationImportPreferences';

export const MAX_PROJECT_CONVERSATION_RETRY_COUNT = 3;

const normalizeProjectConversationNodeTitle = (
  preferredTitle: string,
  fallbackTitle: string,
) => {
  const normalizedPreferredTitle = preferredTitle.trim();
  if (normalizedPreferredTitle) {
    return normalizedPreferredTitle;
  }

  return fallbackTitle.trim() || '대화';
};

type ProjectConversationImportAttemptResult =
  | {
      conversationId: string;
      normalizedConversation: NonNullable<
        ReturnType<typeof normalizeImportedConversation>
      >;
      status: 'success';
    }
  | {
      message: string;
      status: 'fatal';
    }
  | {
      failure: ProjectConversationImportFailure;
      status: 'failure';
    };

export const createProjectConversationIdLookup = (
  conversations: Conversation[],
) => {
  const lookup = new Map<string, string>();
  conversations.forEach((conversation) => {
    if (conversation.refreshRequest?.chatUrl) {
      lookup.set(conversation.refreshRequest.chatUrl, conversation.id);
    }
    if (conversation.sourceUrl) {
      lookup.set(conversation.sourceUrl, conversation.id);
    }
  });
  return lookup;
};

export const getImportedCountFromProgress = (
  progress: ProjectConversationImportProgress | null,
) => {
  if (!progress) {
    return 0;
  }
  if (progress.phase === 'completed') {
    return progress.importedCount;
  }
  if (progress.phase === 'importing') {
    return progress.current;
  }
  return 0;
};

export const getTotalCountFromProgress = (
  progress: ProjectConversationImportProgress | null,
) => {
  if (!progress || progress.phase === 'collecting') {
    return 0;
  }
  return progress.total;
};

export const getRetryableProjectConversationFailures = (
  failures: ProjectConversationImportFailure[],
) => failures.filter((failure) => failure.status !== 'failed');

export const reconcileProjectConversationFailures = ({
  collectedConversations,
  failures,
  importedChatUrls,
}: {
  collectedConversations: ProjectConversationLink[];
  failures: ProjectConversationImportFailure[];
  importedChatUrls: Set<string>;
}) => {
  const collectedChatUrls = new Set(
    collectedConversations.map((conversation) => conversation.chatUrl),
  );
  const failureByUrl = new Map(
    failures.map((failure) => [failure.chatUrl, failure] as const),
  );
  const nextFailures = failures.filter(
    (failure) =>
      collectedChatUrls.has(failure.chatUrl) && !importedChatUrls.has(failure.chatUrl),
  );

  collectedConversations.forEach((conversation) => {
    if (
      importedChatUrls.has(conversation.chatUrl) ||
      failureByUrl.has(conversation.chatUrl)
    ) {
      return;
    }
    nextFailures.push({
      chatUrl: conversation.chatUrl,
      message: '수집된 대화 링크가 작업 공간 노드로 생성되지 않았습니다.',
      retryCount: 0,
      status: 'retryable',
      title: conversation.title,
    });
  });

  const importedCount = Array.from(importedChatUrls).filter((chatUrl) =>
    collectedChatUrls.has(chatUrl),
  ).length;
  const expectedCount = collectedChatUrls.size;
  return {
    expectedCount,
    failures: nextFailures,
    importedCount,
    validationMessage:
      importedCount === expectedCount && nextFailures.length === 0
        ? ''
        : `검증 결과 수집한 대화 ${expectedCount}개 중 작업 공간 노드로 확인된 대화는 ${importedCount}개입니다.`,
  };
};

export async function runProjectConversationImportAttempt({
  conversation,
  conversationIdByUrl,
  importStartedAt,
  normalizedProjectUrl,
  preferredImportStrategy,
  retryCount = 0,
  sequence,
}: {
  conversation: ProjectConversationLink;
  conversationIdByUrl: Map<string, string>;
  importStartedAt: number;
  normalizedProjectUrl: string;
  preferredImportStrategy: ProjectConversationImportStrategyPreference;
  retryCount?: number;
  sequence: number;
}): Promise<ProjectConversationImportAttemptResult> {
  const buildFailureResult = (message: string): ProjectConversationImportAttemptResult => ({
    failure: {
      chatUrl: conversation.chatUrl,
      message,
      retryCount,
      status:
        retryCount >= MAX_PROJECT_CONVERSATION_RETRY_COUNT
          ? 'failed'
          : 'retryable',
      title: conversation.title,
    },
    status: 'failure',
  });

  const finalizeImportedConversation = (
    importedConversation: SharedConversationImport | undefined,
    emptyMessage: string,
  ): ProjectConversationImportAttemptResult => {
    const normalizedConversation = normalizeImportedConversation(importedConversation);
    if (!normalizedConversation || normalizedConversation.messages.length === 0) {
      return buildFailureResult(emptyMessage);
    }

    normalizedConversation.title = normalizeProjectConversationNodeTitle(
      conversation.title,
      normalizedConversation.title,
    );
    if (normalizedConversation.refreshRequest) {
      normalizedConversation.refreshRequest.conversationTitle =
        normalizedConversation.title;
    }

    const conversationId =
      conversationIdByUrl.get(
        normalizedConversation.refreshRequest?.chatUrl ??
          normalizedConversation.sourceUrl,
      ) ?? `shared-${importStartedAt}-${sequence}`;
    conversationIdByUrl.set(normalizedConversation.sourceUrl, conversationId);
    if (normalizedConversation.refreshRequest?.chatUrl) {
      conversationIdByUrl.set(
        normalizedConversation.refreshRequest.chatUrl,
        conversationId,
      );
    }
    return {
      conversationId,
      normalizedConversation,
      status: 'success',
    };
  };

  const decodeFatalErrorMessage = (error: unknown): string | null => {
    const decodedError =
      error instanceof Error
        ? decodeSharedConversationRefreshError(error.message)
        : null;
    return decodedError &&
      ['login_required', 'window_closed'].includes(decodedError.code)
      ? decodedError.message
      : null;
  };

  const shareFlowRequest = {
    chatUrl: conversation.chatUrl,
    conversationTitle: conversation.title,
    helperWindowMode: 'background',
    mode: 'chatgpt-share-flow',
    projectUrl: normalizedProjectUrl,
    shareUrl: conversation.chatUrl,
  } as const;

  const directChatRequest = {
    chatUrl: conversation.chatUrl,
    conversationTitle: conversation.title,
    helperWindowMode: 'background',
    mode: 'direct-chat-page',
    projectUrl: normalizedProjectUrl,
    shareUrl: conversation.chatUrl,
  } as const;

  const attemptShareUrlFirst = async (): Promise<ProjectConversationImportAttemptResult> => {
    try {
      const importedConversation =
        await window.electronAPI?.refreshSharedConversation(shareFlowRequest);
      return finalizeImportedConversation(
        importedConversation,
        '가져온 대화 내용이 비어 있습니다.',
      );
    } catch (error) {
      const fatalMessage = decodeFatalErrorMessage(error);
      if (fatalMessage) {
        return {
          message: fatalMessage,
          status: 'fatal',
        };
      }

      return buildFailureResult(
        error instanceof Error ? error.message : '대화를 불러오지 못했습니다.',
      );
    }
  };

  const attemptChatUrlFirst = async (): Promise<ProjectConversationImportAttemptResult> => {
    try {
      const importedConversation =
        await window.electronAPI?.importChatGptConversation(directChatRequest);
      const result = finalizeImportedConversation(
        importedConversation,
        '원본 ChatGPT 대화에서 내용을 추출하지 못했습니다.',
      );
      if (result.status === 'success') {
        result.normalizedConversation.importOrigin = 'chat-url';
      }
      return result;
    } catch (error) {
      const fatalMessage = decodeFatalErrorMessage(error);
      if (fatalMessage) {
        return {
          message: fatalMessage,
          status: 'fatal',
        };
      }

      return buildFailureResult(
        error instanceof Error ? error.message : '대화를 불러오지 못했습니다.',
      );
    }
  };

  const attemptChain =
    preferredImportStrategy === 'chat-url-first'
      ? [attemptChatUrlFirst, attemptShareUrlFirst]
      : [attemptShareUrlFirst, attemptChatUrlFirst];

  let lastFailure: ProjectConversationImportAttemptResult = buildFailureResult(
    '대화를 불러오지 못했습니다.',
  );

  for (const attempt of attemptChain) {
    const result = await attempt();
    if (result.status === 'success' || result.status === 'fatal') {
      return result;
    }
    lastFailure = result;
  }

  return lastFailure;
}
