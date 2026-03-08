import type { MutableRefObject } from 'react';
import type {
  ProjectConversationImportFailure,
  ProjectConversationImportMode,
} from '../../../../shared/import/projectConversationImport';
import { applyImportedProjectConversation } from './projectConversationImportBatch';
import { applyProjectImportValidationState } from './projectConversationImportValidation';
import {
  getImportedCountFromProgress,
  getTotalCountFromProgress,
  MAX_PROJECT_CONVERSATION_RETRY_COUNT,
  runProjectConversationImportAttempt,
} from './projectConversationImportHelpers';
import type { CommonProjectImportArgs } from './projectConversationImportWorkflow';
import type { ProjectConversationImportPreferences } from './projectConversationImportPreferences';

export async function retryProjectConversationImportWorkflow({
  failure,
  importedProjectConversationUrlsRef,
  messageHeightCacheRef,
  projectCollectedConversationsRef,
  projectConversationIdByUrlRef,
  projectImportContextRef,
  projectImportFailures,
  projectImportMode,
  projectImportPreferences,
  setConversations,
  setIsProjectImportModalOpen,
  setProjectImportError,
  setProjectImportFailures,
  setProjectImportProgress,
  setProjectSyncSummary,
  setWorkspaceTree,
}: CommonProjectImportArgs & {
  failure: ProjectConversationImportFailure;
  importedProjectConversationUrlsRef: MutableRefObject<Set<string>>;
  projectImportFailures: ProjectConversationImportFailure[];
  projectImportMode: ProjectConversationImportMode;
  projectImportPreferences: ProjectConversationImportPreferences;
}) {
  const importContext = projectImportContextRef.current;
  if (!importContext) {
    return;
  }

  const currentFailureCount = projectImportFailures.length;
  setProjectImportError('');
  setProjectImportFailures((current) =>
    current.map((item) =>
      item.chatUrl === failure.chatUrl
        ? { ...item, retryCount: failure.retryCount + 1, status: 'retrying' }
        : item,
    ),
  );
  setProjectImportProgress((current) => ({
    current: getImportedCountFromProgress(current),
    failedCount: currentFailureCount,
    phase: 'importing',
    title: `${failure.title} 재시도 중`,
    total: getTotalCountFromProgress(current),
  }));

  const currentFailures = projectImportFailures;
  const result = await runProjectConversationImportAttempt({
    conversation: {
      chatUrl: failure.chatUrl,
      title: failure.title,
    },
    conversationIdByUrl: projectConversationIdByUrlRef.current,
    importStartedAt: importContext.importStartedAt,
    normalizedProjectUrl: importContext.projectUrl,
    preferredImportStrategy: projectImportPreferences.preferredStrategy,
    retryCount: failure.retryCount + 1,
    sequence: Date.now(),
  });

  if (result.status === 'success') {
    importedProjectConversationUrlsRef.current.add(failure.chatUrl);
    applyImportedProjectConversation({
      conversationId: result.conversationId,
      folderId: importContext.folderId,
      messageHeightCacheRef,
      normalizedConversation: result.normalizedConversation,
      setConversations,
      setWorkspaceTree,
    });
    const nextFailures = currentFailures.filter(
      (item) => item.chatUrl !== failure.chatUrl,
    );
    const validatedFailures = applyProjectImportValidationState({
      collectedConversations: projectCollectedConversationsRef.current,
      failures: nextFailures,
      importedChatUrls: importedProjectConversationUrlsRef.current,
      setProjectImportError,
      setProjectImportFailures,
      setProjectImportProgress,
    });
    setProjectSyncSummary((current) =>
      current
        ? {
            ...current,
            matchedCount: importedProjectConversationUrlsRef.current.size,
            missingCount: validatedFailures.length,
          }
        : current,
    );
    if (projectImportMode === 'import' && validatedFailures.length === 0) {
      setIsProjectImportModalOpen(false);
    }
    return;
  }

  const nextFailure =
    result.status === 'fatal'
      ? {
          ...failure,
          message: result.message,
          retryCount: MAX_PROJECT_CONVERSATION_RETRY_COUNT,
          status: 'failed' as const,
        }
      : result.failure;
  const nextFailures = currentFailures.map((item) =>
    item.chatUrl === failure.chatUrl ? nextFailure : item,
  );
  applyProjectImportValidationState({
    collectedConversations: projectCollectedConversationsRef.current,
    failures: nextFailures,
    importedChatUrls: importedProjectConversationUrlsRef.current,
    overrideErrorMessage: result.status === 'fatal' ? result.message : '',
    setProjectImportError,
    setProjectImportFailures,
    setProjectImportProgress,
  });
  setProjectSyncSummary((current) =>
    current
      ? {
          ...current,
          matchedCount: importedProjectConversationUrlsRef.current.size,
          missingCount: nextFailures.length,
        }
      : current,
  );
}
