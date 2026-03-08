import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from 'react';
import type {
  ProjectConversationImportFailure,
  ProjectConversationImportProgress,
  ProjectConversationLink,
} from '../../../../shared/import/projectConversationImport';
import {
  addFolderToTree,
  canDropNodeInFolder,
  findConversationNodeId,
  findFolderById,
  insertConversationIntoFolder,
  moveNodeInTree,
} from '../../conversations/lib/workspaceTree';
import type { Conversation, WorkspaceNode } from '../../../types/chat';
import { buildConversationFromImport } from './sharedConversationUtils';
import { runProjectConversationImportAttempt } from './projectConversationImportHelpers';
import type { ProjectConversationImportStrategyPreference } from './projectConversationImportPreferences';

export const ensureProjectImportFolder = ({
  parentFolderId,
  projectUrl,
  projectTitle,
  setExpandedFolderState,
  setWorkspaceTree,
  syncTargetFolderId,
  workspaceTree,
}: {
  parentFolderId: string | null;
  projectUrl: string;
  projectTitle: string;
  setExpandedFolderState: Dispatch<SetStateAction<Record<string, boolean>>>;
  setWorkspaceTree: Dispatch<SetStateAction<WorkspaceNode[]>>;
  syncTargetFolderId: string | null;
  workspaceTree: WorkspaceNode[];
}) => {
  const existingProjectFolder = syncTargetFolderId
    ? findFolderById(workspaceTree, syncTargetFolderId)
    : null;
  let folderId = existingProjectFolder?.id ?? '';
  if (!existingProjectFolder) {
    const nextWorkspaceTree = addFolderToTree(
      workspaceTree,
      projectTitle,
      parentFolderId,
      {
      kind: 'project',
      projectUrl,
      },
    );
    folderId = nextWorkspaceTree.folderId;
    setWorkspaceTree(nextWorkspaceTree.tree);
  }
  setExpandedFolderState((current) => ({ ...current, [folderId]: true }));
  return folderId;
};

export const applyImportedProjectConversation = ({
  conversationId,
  folderId,
  messageHeightCacheRef,
  normalizedConversation,
  setConversations,
  setWorkspaceTree,
}: {
  conversationId: string;
  folderId: string;
  messageHeightCacheRef: MutableRefObject<Record<string, Record<string, number>>>;
  normalizedConversation: Parameters<typeof buildConversationFromImport>[1];
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
  setWorkspaceTree: Dispatch<SetStateAction<WorkspaceNode[]>>;
}) => {
  const nextConversation = buildConversationFromImport(
    conversationId,
    normalizedConversation,
  );
  messageHeightCacheRef.current[conversationId] = {};
  setConversations((currentConversations) => {
    const existingIndex = currentConversations.findIndex(
      (item) => item.id === conversationId,
    );
    if (existingIndex < 0) {
      return [nextConversation, ...currentConversations];
    }
    const nextConversations = [...currentConversations];
    nextConversations[existingIndex] = nextConversation;
    return nextConversations;
  });
  setWorkspaceTree((currentTree) => {
    const existingNodeId = findConversationNodeId(currentTree, conversationId);
    if (!existingNodeId) {
      return insertConversationIntoFolder(currentTree, folderId, conversationId);
    }
    if (!canDropNodeInFolder(currentTree, existingNodeId, folderId)) {
      return currentTree;
    }
    return moveNodeInTree(currentTree, existingNodeId, folderId);
  });
};

export async function runProjectConversationImportBatch({
  conversationIdByUrl,
  concurrency,
  conversations,
  folderId,
  importStartedAt,
  initialImportedCount = 0,
  messageHeightCacheRef,
  normalizedProjectUrl,
  onConversationImported,
  preferredImportStrategy,
  progressTotal = conversations.length,
  setConversations,
  setProjectImportProgress,
  setWorkspaceTree,
}: {
  conversationIdByUrl: Map<string, string>;
  concurrency: number;
  conversations: ProjectConversationLink[];
  folderId: string;
  importStartedAt: number;
  initialImportedCount?: number;
  messageHeightCacheRef: MutableRefObject<Record<string, Record<string, number>>>;
  normalizedProjectUrl: string;
  onConversationImported?: (chatUrl: string) => void;
  preferredImportStrategy: ProjectConversationImportStrategyPreference;
  progressTotal?: number;
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
  setProjectImportProgress: Dispatch<
    SetStateAction<ProjectConversationImportProgress | null>
  >;
  setWorkspaceTree: Dispatch<SetStateAction<WorkspaceNode[]>>;
}) {
  const failures: ProjectConversationImportFailure[] = [];
  const importedConversationIds = new Set<string>();
  let firstImportedConversationId: string | null = null;
  let nextIndex = 0;
  let fatalError: string | null = null;

  const runImportWorker = async () => {
    while (nextIndex < conversations.length && !fatalError) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const conversation = conversations[currentIndex];

      try {
        const result = await runProjectConversationImportAttempt({
          conversation,
          conversationIdByUrl,
          importStartedAt,
          normalizedProjectUrl,
          preferredImportStrategy,
          sequence: currentIndex,
        });
        if (result.status === 'fatal') {
          fatalError = result.message;
        } else if (result.status === 'failure') {
          failures.push(result.failure);
        } else {
          importedConversationIds.add(result.conversationId);
          firstImportedConversationId ??= result.conversationId;
          applyImportedProjectConversation({
            conversationId: result.conversationId,
            folderId,
            messageHeightCacheRef,
            normalizedConversation: result.normalizedConversation,
            setConversations,
            setWorkspaceTree,
          });
          onConversationImported?.(conversation.chatUrl);
        }
      } catch (error) {
        fatalError =
          error instanceof Error
            ? error.message
            : '프로젝트 대화를 불러오지 못했습니다.';
      } finally {
        setProjectImportProgress({
          current: initialImportedCount + importedConversationIds.size,
          failedCount: failures.length,
          phase: 'importing',
          title: conversation.title,
          total: progressTotal,
        });
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, conversations.length) },
      () => runImportWorker(),
    ),
  );

  return {
    failures,
    fatalError,
    firstImportedConversationId,
    importedCount: importedConversationIds.size,
  };
}
