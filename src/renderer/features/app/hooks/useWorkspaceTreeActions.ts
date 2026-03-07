import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import {
  addFolderToTree,
  buildFolderOptions,
  canDropNodeInFolder,
  canMoveNodeRelativeToTarget,
  collectConversationIds,
  collectDescendantFolderIds,
  countTreeItems,
  findFirstConversationId,
  findFolderById,
  findParentFolderId,
  moveFolderInTree,
  moveNodeInTree,
  moveNodeRelativeToTarget,
  renameFolderInTree,
  removeFolderFromTree,
} from '../../conversations/lib/workspaceTree';
import type { Conversation, SourceDrawerState, WorkspaceNode } from '../../../types/chat';
import type {
  CreateFolderState,
  DeleteFolderState,
  MoveFolderState,
  RenameConversationState,
  RenameFolderState,
} from '../lib/appTypes';

type UseWorkspaceTreeActionsArgs = {
  activeConversationId: string;
  conversations: Conversation[];
  removeConversationScrollState: (conversationIds: string[]) => void;
  setActiveConversationId: (value: string) => void;
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
  setExpandedFolderState: Dispatch<SetStateAction<Record<string, boolean>>>;
  setSourceDrawer: Dispatch<SetStateAction<SourceDrawerState | null>>;
  setWorkspaceTree: Dispatch<SetStateAction<WorkspaceNode[]>>;
  workspaceTree: WorkspaceNode[];
};

export function useWorkspaceTreeActions({
  activeConversationId,
  conversations,
  removeConversationScrollState,
  setActiveConversationId,
  setConversations,
  setExpandedFolderState,
  setSourceDrawer,
  setWorkspaceTree,
  workspaceTree,
}: UseWorkspaceTreeActionsArgs) {
  const [createFolderState, setCreateFolderState] = useState<CreateFolderState | null>(null);
  const [moveFolderState, setMoveFolderState] = useState<MoveFolderState | null>(null);
  const [deleteFolderState, setDeleteFolderState] = useState<DeleteFolderState | null>(null);
  const [renameConversationState, setRenameConversationState] = useState<RenameConversationState | null>(null);
  const [renameFolderState, setRenameFolderState] = useState<RenameFolderState | null>(null);
  const [folderOperationError, setFolderOperationError] = useState('');

  const moveFolderOptions = useMemo(() => {
    if (!moveFolderState) return [];
    const folderToMove = findFolderById(workspaceTree, moveFolderState.folderId);
    if (!folderToMove) return [];
    return buildFolderOptions(
      workspaceTree,
      new Set([folderToMove.id, ...collectDescendantFolderIds(folderToMove)]),
    );
  }, [moveFolderState, workspaceTree]);

  useEffect(() => {
    if (!createFolderState && !moveFolderState && !deleteFolderState && !renameConversationState && !renameFolderState) {
      setFolderOperationError('');
    }
  }, [createFolderState, deleteFolderState, moveFolderState, renameConversationState, renameFolderState]);

  const handleConversationSelect = (conversationId: string) => setActiveConversationId(conversationId);
  const handleFolderToggle = (folderId: string) => {
    setExpandedFolderState((current) => ({ ...current, [folderId]: !current[folderId] }));
  };
  const handleTreeNodeDrop = (nodeId: string, destinationFolderId: string | null) => {
    if (!canDropNodeInFolder(workspaceTree, nodeId, destinationFolderId)) return;
    setWorkspaceTree((currentTree) => moveNodeInTree(currentTree, nodeId, destinationFolderId));
    setExpandedFolderState((current) => ({ ...current, ...(destinationFolderId ? { [destinationFolderId]: true } : {}) }));
  };
  const handleTreeNodeReorder = (nodeId: string, targetNodeId: string, position: 'after' | 'before') => {
    if (!canMoveNodeRelativeToTarget(workspaceTree, nodeId, targetNodeId, position)) return;
    setWorkspaceTree((currentTree) => moveNodeRelativeToTarget(currentTree, nodeId, targetNodeId, position));
  };
  const openCreateFolderModal = (parentFolderId: string | null) => {
    setFolderOperationError('');
    setCreateFolderState({ folderName: '', parentFolderId });
  };
  const openMoveFolderModal = (folderId: string) => {
    const folderToMove = findFolderById(workspaceTree, folderId);
    if (!folderToMove) return;
    const currentParentFolderId = findParentFolderId(workspaceTree, folderId);
    const destinationOptions = buildFolderOptions(
      workspaceTree,
      new Set([folderToMove.id, ...collectDescendantFolderIds(folderToMove)]),
    );
    setFolderOperationError('');
    setMoveFolderState({
      destinationFolderId: destinationOptions.some((option) => option.id === currentParentFolderId) ? currentParentFolderId : null,
      folderId,
      folderName: folderToMove.name,
    });
  };
  const openRenameFolderModal = (folderId: string) => {
    const folderToRename = findFolderById(workspaceTree, folderId);
    if (!folderToRename) return;
    setFolderOperationError('');
    setRenameFolderState({ folderId, folderName: folderToRename.name, nextName: folderToRename.name });
  };
  const openRenameConversationModal = (conversationId: string) => {
    const conversationToRename = conversations.find((conversation) => conversation.id === conversationId);
    if (!conversationToRename) return;
    setFolderOperationError('');
    setRenameConversationState({
      conversationId,
      currentTitle: conversationToRename.title,
      nextTitle: conversationToRename.title,
    });
  };

  const deleteFolder = (folderId: string) => {
    const removalResult = removeFolderFromTree(workspaceTree, folderId);
    if (!removalResult.removedFolder) return;

    const removedConversationIds = collectConversationIds([removalResult.removedFolder]);
    const removedFolderIds = [removalResult.removedFolder.id, ...collectDescendantFolderIds(removalResult.removedFolder)];
    const nextConversations = conversations.filter(
      (conversation) => !removedConversationIds.includes(conversation.id),
    );
    const nextActiveConversationId = nextConversations.some(
      (conversation) => conversation.id === activeConversationId,
    )
      ? activeConversationId
      : findFirstConversationId(removalResult.tree) || nextConversations[0]?.id || '';

    removeConversationScrollState(removedConversationIds);
    setSourceDrawer(null);
    setConversations(nextConversations);
    setWorkspaceTree(removalResult.tree);
    setExpandedFolderState((current) => {
      const nextState = { ...current };
      removedFolderIds.forEach((removedFolderId) => delete nextState[removedFolderId]);
      return nextState;
    });
    setActiveConversationId(nextActiveConversationId);
  };

  const handleFolderDeleteRequest = (folderId: string) => {
    const folderToDelete = findFolderById(workspaceTree, folderId);
    if (!folderToDelete) return;
    const subtreeCounts = countTreeItems(folderToDelete.children);
    if (subtreeCounts.folderCount === 0 && subtreeCounts.conversationCount === 0) return deleteFolder(folderId);
    setFolderOperationError('');
    setDeleteFolderState({ ...subtreeCounts, folderId, folderName: folderToDelete.name });
  };

  const handleCreateFolderSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!createFolderState) return;
    const folderName = createFolderState.folderName.trim();
    if (!folderName) return setFolderOperationError('폴더 이름을 입력해 주세요.');
    const nextFolder = addFolderToTree(workspaceTree, folderName, createFolderState.parentFolderId);
    setWorkspaceTree(nextFolder.tree);
    setExpandedFolderState((current) => ({
      ...current,
      [nextFolder.folderId]: true,
      ...(createFolderState.parentFolderId ? { [createFolderState.parentFolderId]: true } : {}),
    }));
    setFolderOperationError('');
    setCreateFolderState(null);
  };

  const handleMoveFolderSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!moveFolderState) return;
    if (findParentFolderId(workspaceTree, moveFolderState.folderId) === moveFolderState.destinationFolderId) {
      setMoveFolderState(null);
      return;
    }
    setWorkspaceTree((currentTree) =>
      moveFolderInTree(currentTree, moveFolderState.folderId, moveFolderState.destinationFolderId),
    );
    setExpandedFolderState((current) => ({
      ...current,
      ...(moveFolderState.destinationFolderId ? { [moveFolderState.destinationFolderId]: true } : {}),
    }));
    setFolderOperationError('');
    setMoveFolderState(null);
  };

  const handleRenameFolderSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!renameFolderState) return;
    const nextName = renameFolderState.nextName.trim();
    if (!nextName) return setFolderOperationError('폴더 이름을 입력해 주세요.');
    setWorkspaceTree((currentTree) => renameFolderInTree(currentTree, renameFolderState.folderId, nextName));
    setFolderOperationError('');
    setRenameFolderState(null);
  };

  const handleRenameConversationSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!renameConversationState) return;
    const nextTitle = renameConversationState.nextTitle.trim();
    if (!nextTitle) return setFolderOperationError('대화 제목을 입력해 주세요.');
    setConversations((currentConversations) =>
      currentConversations.map((conversation) =>
        conversation.id === renameConversationState.conversationId ? { ...conversation, title: nextTitle } : conversation,
      ),
    );
    setFolderOperationError('');
    setRenameConversationState(null);
  };

  return {
    createFolderState,
    deleteFolder,
    deleteFolderState,
    folderOperationError,
    handleConversationSelect,
    handleCreateFolderSubmit,
    handleFolderDeleteRequest,
    handleFolderToggle,
    handleMoveFolderSubmit,
    handleRenameConversationSubmit,
    handleRenameFolderSubmit,
    handleTreeNodeDrop,
    handleTreeNodeReorder,
    moveFolderOptions,
    moveFolderState,
    openCreateFolderModal,
    openMoveFolderModal,
    openRenameConversationModal,
    openRenameFolderModal,
    renameConversationState,
    renameFolderState,
    setCreateFolderState,
    setDeleteFolderState,
    setMoveFolderState,
    setRenameConversationState,
    setRenameFolderState,
  };
}
