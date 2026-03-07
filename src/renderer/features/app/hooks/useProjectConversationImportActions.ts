import { useEffect, useState, type Dispatch, type SetStateAction, type MutableRefObject, type FormEvent } from 'react';
import { normalizeImportedConversation } from '../../conversations/lib/normalizers';
import {
  addFolderToTree,
  canDropNodeInFolder,
  findConversationNodeId,
  insertConversationIntoFolder,
  moveNodeInTree,
} from '../../conversations/lib/workspaceTree';
import type { Conversation, SourceDrawerState, WorkspaceNode } from '../../../types/chat';
import { buildConversationFromImport, normalizeProjectUrl } from '../lib/sharedConversationUtils';

type UseProjectConversationImportActionsArgs = {
  conversations: Conversation[];
  messageHeightCacheRef: MutableRefObject<Record<string, Record<string, number>>>;
  setActiveConversationId: (value: string) => void;
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
  setExpandedFolderState: Dispatch<SetStateAction<Record<string, boolean>>>;
  setSourceDrawer: Dispatch<SetStateAction<SourceDrawerState | null>>;
  setWorkspaceTree: Dispatch<SetStateAction<WorkspaceNode[]>>;
  workspaceTree: WorkspaceNode[];
};

export function useProjectConversationImportActions({
  conversations,
  messageHeightCacheRef,
  setActiveConversationId,
  setConversations,
  setExpandedFolderState,
  setSourceDrawer,
  setWorkspaceTree,
  workspaceTree,
}: UseProjectConversationImportActionsArgs) {
  const [isProjectImportModalOpen, setIsProjectImportModalOpen] = useState(false);
  const [isImportingProjectConversations, setIsImportingProjectConversations] =
    useState(false);
  const [projectImportError, setProjectImportError] = useState('');
  const [projectImportUrl, setProjectImportUrl] = useState('');

  useEffect(() => {
    if (isProjectImportModalOpen) {
      return;
    }
    setIsImportingProjectConversations(false);
    setProjectImportError('');
    setProjectImportUrl('');
  }, [isProjectImportModalOpen]);

  const handleImportProjectConversations = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    if (isImportingProjectConversations) {
      return;
    }

    const normalizedProjectUrl = normalizeProjectUrl(projectImportUrl);
    if (!normalizedProjectUrl) {
      setProjectImportError('올바른 ChatGPT 프로젝트 URL을 입력해 주세요.');
      return;
    }

    setProjectImportError('');
    setIsImportingProjectConversations(true);
    try {
      const importedProject = await window.electronAPI?.importProjectConversations({
        projectUrl: normalizedProjectUrl,
      });
      if (!importedProject) {
        throw new Error('프로젝트 대화를 불러오는 기능을 사용할 수 없습니다.');
      }

      const importedEntries = importedProject.conversations
        .map((conversation, index) => {
          const normalizedConversation = normalizeImportedConversation(conversation);
          if (!normalizedConversation || normalizedConversation.messages.length === 0) {
            return null;
          }

          const existingConversation = conversations.find(
            (item) =>
              (normalizedConversation.refreshRequest?.chatUrl &&
                item.refreshRequest?.chatUrl ===
                  normalizedConversation.refreshRequest.chatUrl) ||
              item.sourceUrl === normalizedConversation.sourceUrl,
          );
          const conversationId =
            existingConversation?.id ?? `shared-${Date.now()}-${index}`;

          return {
            conversationId,
            normalizedConversation,
          };
        })
        .filter(
          (
            entry,
          ): entry is {
            conversationId: string;
            normalizedConversation: NonNullable<
              ReturnType<typeof normalizeImportedConversation>
            >;
          } => !!entry,
        );

      if (importedEntries.length === 0) {
        throw new Error(
          importedProject.failures[0]?.message ??
            '프로젝트에서 불러올 수 있는 대화를 찾지 못했습니다.',
        );
      }

      importedEntries.forEach((entry) => {
        messageHeightCacheRef.current[entry.conversationId] = {};
      });

      setConversations((currentConversations) => {
        const remainingConversations = [...currentConversations];
        const createdConversations = importedEntries.map((entry) => {
          const nextConversation = buildConversationFromImport(
            entry.conversationId,
            entry.normalizedConversation,
          );
          const existingIndex = remainingConversations.findIndex(
            (conversation) => conversation.id === entry.conversationId,
          );
          if (existingIndex >= 0) {
            remainingConversations[existingIndex] = nextConversation;
            return null;
          }
          return nextConversation;
        });

        return [
          ...createdConversations.filter(
            (conversation): conversation is Conversation => !!conversation,
          ),
          ...remainingConversations,
        ];
      });

      const folderName = importedProject.projectTitle.trim() || '프로젝트';
      const { folderId, tree: nextWorkspaceTree } = addFolderToTree(
        workspaceTree,
        folderName,
        null,
      );
      const orderedConversationIds = importedEntries.map(
        (entry) => entry.conversationId,
      );
      const finalWorkspaceTree = orderedConversationIds
        .slice()
        .reverse()
        .reduce<WorkspaceNode[]>((currentTree, conversationId) => {
          const existingNodeId = findConversationNodeId(currentTree, conversationId);
          if (!existingNodeId) {
            return insertConversationIntoFolder(currentTree, folderId, conversationId);
          }
          if (!canDropNodeInFolder(currentTree, existingNodeId, folderId)) {
            return currentTree;
          }
          return moveNodeInTree(currentTree, existingNodeId, folderId);
        }, nextWorkspaceTree);

      setWorkspaceTree(finalWorkspaceTree);
      setExpandedFolderState((current) => ({
        ...current,
        [folderId]: true,
      }));
      setSourceDrawer(null);
      setActiveConversationId(importedEntries[0].conversationId);
      setIsProjectImportModalOpen(false);
    } catch (error) {
      setProjectImportError(
        error instanceof Error
          ? error.message
          : '프로젝트 대화를 불러오지 못했습니다.',
      );
    } finally {
      setIsImportingProjectConversations(false);
    }
  };

  return {
    handleImportProjectConversations,
    isImportingProjectConversations,
    isProjectImportModalOpen,
    projectImportError,
    projectImportUrl,
    setIsProjectImportModalOpen,
    setProjectImportUrl,
  };
}
