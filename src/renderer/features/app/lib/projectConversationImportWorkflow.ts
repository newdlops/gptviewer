import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from 'react';
import type {
  ProjectConversationImportFailure,
  ProjectConversationImportMode,
  ProjectConversationImportProgress,
  ProjectConversationLink,
  ProjectConversationSyncSummary,
} from '../../../../shared/import/projectConversationImport';
import type { Conversation, SourceDrawerState, WorkspaceNode } from '../../../types/chat';
import {
  ensureProjectImportFolder,
  runProjectConversationImportBatch,
} from './projectConversationImportBatch';
import {
  applyProjectFolderSyncStatuses,
  createProjectFolderSyncPlan,
} from './projectConversationSyncHelpers';
import { applyProjectImportValidationState } from './projectConversationImportValidation';
import {
  createProjectConversationIdLookup,
} from './projectConversationImportHelpers';
import type { ProjectConversationImportPreferences } from './projectConversationImportPreferences';

export type ProjectImportContextRef = MutableRefObject<{
  folderId: string;
  importStartedAt: number;
  projectUrl: string;
} | null>;

export type CommonProjectImportArgs = {
  conversations: Conversation[];
  messageHeightCacheRef: MutableRefObject<Record<string, Record<string, number>>>;
  projectCollectedConversationsRef: MutableRefObject<ProjectConversationLink[]>;
  projectConversationIdByUrlRef: MutableRefObject<Map<string, string>>;
  projectImportContextRef: ProjectImportContextRef;
  setActiveConversationId: (value: string) => void;
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
  setExpandedFolderState: Dispatch<SetStateAction<Record<string, boolean>>>;
  setIsProjectImportModalOpen: Dispatch<SetStateAction<boolean>>;
  setProjectImportError: Dispatch<SetStateAction<string>>;
  setProjectImportFailures: Dispatch<
    SetStateAction<ProjectConversationImportFailure[]>
  >;
  setProjectImportProgress: Dispatch<
    SetStateAction<ProjectConversationImportProgress | null>
  >;
  setProjectSyncSummary: Dispatch<
    SetStateAction<ProjectConversationSyncSummary | null>
  >;
  setSourceDrawer: Dispatch<SetStateAction<SourceDrawerState | null>>;
  setWorkspaceTree: Dispatch<SetStateAction<WorkspaceNode[]>>;
  workspaceTree: WorkspaceNode[];
};

export async function runProjectConversationImportWorkflow({
  conversations,
  importedProjectConversationUrlsRef,
  messageHeightCacheRef,
  projectImportParentFolderId,
  normalizedProjectUrl,
  projectImportMode,
  projectImportTargetFolderId,
  projectImportPreferences,
  projectCollectedConversationsRef,
  projectConversationIdByUrlRef,
  projectImportContextRef,
  setActiveConversationId,
  setConversations,
  setExpandedFolderState,
  setIsProjectImportModalOpen,
  setProjectImportError,
  setProjectImportFailures,
  setProjectImportProgress,
  setProjectSyncSummary,
  setSourceDrawer,
  setWorkspaceTree,
  workspaceTree,
  isForceSync,
}: CommonProjectImportArgs & {
  importedProjectConversationUrlsRef: MutableRefObject<Set<string>>;
  projectImportParentFolderId: string | null;
  projectImportPreferences: ProjectConversationImportPreferences;
  normalizedProjectUrl: string;
  projectImportMode: ProjectConversationImportMode;
  projectImportTargetFolderId: string | null;
  isForceSync?: boolean;
}) {
  const collectedProject = await window.electronAPI?.collectProjectConversationLinks({
    projectUrl: normalizedProjectUrl,
  });
  if (!collectedProject) {
    throw new Error('프로젝트 대화 목록을 불러오는 기능을 사용할 수 없습니다.');
  }
  if (collectedProject.conversations.length === 0) {
    throw new Error('프로젝트에서 불러올 수 있는 대화를 찾지 못했습니다.');
  }

  const folderId = ensureProjectImportFolder({
    parentFolderId: projectImportMode === 'sync' ? null : projectImportParentFolderId,
    projectTitle: collectedProject.projectTitle.trim() || '프로젝트',
    projectUrl: normalizedProjectUrl,
    setExpandedFolderState,
    setWorkspaceTree,
    syncTargetFolderId: projectImportTargetFolderId,
    workspaceTree,
  });
  const syncPlan =
    projectImportMode === 'sync'
      ? createProjectFolderSyncPlan({
          collectedConversations: collectedProject.conversations,
          conversations,
          folderId,
          workspaceTree,
          isForceSync,
        })
      : null;

  const importStartedAt = Date.now();
  projectImportContextRef.current = {
    folderId,
    importStartedAt,
    projectUrl: normalizedProjectUrl,
  };
  projectCollectedConversationsRef.current = collectedProject.conversations;
  projectConversationIdByUrlRef.current =
    createProjectConversationIdLookup(conversations);
  importedProjectConversationUrlsRef.current = new Set(
    syncPlan ? syncPlan.existingMatchedChatUrls : [],
  );

  if (syncPlan) {
    setConversations((current) =>
      applyProjectFolderSyncStatuses(
        current,
        syncPlan.folderConversationIds,
        syncPlan.viewerCreatedConversationIds,
      ),
    );
    setProjectSyncSummary(syncPlan.summary);
  }

  setProjectImportProgress({
    current: syncPlan?.summary.matchedCount ?? 0,
    failedCount: 0,
    phase: 'importing',
    title:
      projectImportMode === 'sync'
        ? '누락된 대화를 확인하는 중'
        : '병렬로 대화를 불러오는 중',
    total: collectedProject.conversations.length,
  });

  if (syncPlan && syncPlan.missingConversations.length === 0) {
    setProjectImportProgress({
      failedCount: 0,
      importedCount: syncPlan.summary.matchedCount,
      phase: 'completed',
      total: collectedProject.conversations.length,
    });
    return;
  }

  const { failures, fatalError, firstImportedConversationId, importedCount } =
    await runProjectConversationImportBatch({
      conversationIdByUrl: projectConversationIdByUrlRef.current,
      concurrency: projectImportPreferences.workerCount,
      conversations: syncPlan?.missingConversations ?? collectedProject.conversations,
      folderId,
      importStartedAt,
      initialImportedCount: syncPlan?.summary.matchedCount ?? 0,
      messageHeightCacheRef,
      normalizedProjectUrl,
      onConversationImported: (chatUrl) => {
        importedProjectConversationUrlsRef.current.add(chatUrl);
      },
      preferredImportStrategy: projectImportPreferences.preferredStrategy,
      progressTotal: collectedProject.conversations.length,
      setConversations,
      setProjectImportProgress,
      setWorkspaceTree,
    });

  if (fatalError) {
    throw new Error(fatalError);
  }

  if ((syncPlan?.summary.matchedCount ?? 0) + importedCount === 0) {
    throw new Error(
      failures[0]?.message ?? '프로젝트에서 불러올 수 있는 대화를 찾지 못했습니다.',
    );
  }

  const validatedFailures = applyProjectImportValidationState({
    collectedConversations: projectCollectedConversationsRef.current,
    failures,
    importedChatUrls: importedProjectConversationUrlsRef.current,
    setProjectImportError,
    setProjectImportFailures,
    setProjectImportProgress,
  });

  if (syncPlan) {
    setProjectSyncSummary({
      collectedCount: syncPlan.summary.collectedCount,
      matchedCount: importedProjectConversationUrlsRef.current.size,
      missingCount: validatedFailures.length,
      viewerCreatedCount: syncPlan.summary.viewerCreatedCount,
    });
  }

  setSourceDrawer(null);
  if (firstImportedConversationId) {
    setActiveConversationId(firstImportedConversationId);
  }
  if (projectImportMode === 'import' && validatedFailures.length === 0) {
    setIsProjectImportModalOpen(false);
  }
}
