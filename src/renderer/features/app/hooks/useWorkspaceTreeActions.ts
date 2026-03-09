import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import {
  addFolderToTree,
  buildFolderOptions,
  canDropNodeInFolder,
  canMoveNodeRelativeToTarget,
  collectConversationIds,
  collectDescendantFolderIds,
  countTreeItems,
  findConversationNodeId,
  findFirstConversationId,
  findFolderById,
  findParentFolderId,
  moveFolderInTree,
  moveNodeInTree,
  moveNodeRelativeToTarget,
  renameFolderInTree,
  removeFolderFromTree,
  removeNodeFromTree,
  updateFolderSortModeInTree,
  updateFolderSourceInTree,
} from '../../conversations/lib/workspaceTree';
import type {
  Conversation,
  SourceDrawerState,
  WorkspaceFolderSortMode,
  WorkspaceNode,
} from '../../../types/chat';
import type {
  CreateFolderState,
  DeleteConversationState,
  DeleteFolderState,
  MoveFolderState,
  ProjectFolderState,
  RenameConversationState,
  RenameFolderState,
} from '../lib/appTypes';
import { normalizeProjectUrl } from '../lib/sharedConversationUtils';

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
  const [deleteConversationState, setDeleteConversationState] = useState<DeleteConversationState | null>(null);
  const [deleteFolderState, setDeleteFolderState] = useState<DeleteFolderState | null>(null);
  const [projectFolderState, setProjectFolderState] = useState<ProjectFolderState | null>(null);
  const [renameConversationState, setRenameConversationState] = useState<RenameConversationState | null>(null);
  const [renameFolderState, setRenameFolderState] = useState<RenameFolderState | null>(null);
  const [folderOperationError, setFolderOperationError] = useState('');
  const [globalFolderSortMode, setGlobalFolderSortMode] = useState<WorkspaceFolderSortMode | null>(() => {
    const savedSortMode = window.localStorage.getItem('workspace-global-sort-mode');

    if (
      savedSortMode === 'asc' ||
      savedSortMode === 'desc' ||
      savedSortMode === 'none'
    ) {
      return savedSortMode;
    }

    return null;
  });
  const getNextFolderSortMode = (
    currentSortMode: WorkspaceFolderSortMode | undefined,
  ): WorkspaceFolderSortMode | undefined => {
    if (currentSortMode === 'desc') {
      return 'asc';
    }

    if (currentSortMode === 'asc') {
      return undefined;
    }

    return 'desc';
  };

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
    if (!createFolderState && !moveFolderState && !deleteConversationState && !deleteFolderState && !projectFolderState && !renameConversationState && !renameFolderState) {
      setFolderOperationError('');
    }
  }, [createFolderState, deleteConversationState, deleteFolderState, moveFolderState, projectFolderState, renameConversationState, renameFolderState]);
  useEffect(() => {
    if (globalFolderSortMode === null) {
      window.localStorage.removeItem('workspace-global-sort-mode');
      return;
    }

    window.localStorage.setItem('workspace-global-sort-mode', globalFolderSortMode);
  }, [globalFolderSortMode]);

  const handleConversationSelect = (conversationId: string) => setActiveConversationId(conversationId);
  const handleFolderToggle = (folderId: string) => {
    setExpandedFolderState((current) => ({ ...current, [folderId]: !current[folderId] }));
  };
  const handleFolderSortToggle = (folderId: string) => {
    const folder = findFolderById(workspaceTree, folderId);

    if (!folder) {
      return;
    }

    setWorkspaceTree((currentTree) =>
      updateFolderSortModeInTree(
        currentTree,
        folderId,
        getNextFolderSortMode(folder.sortMode),
      ),
    );
  };
  const handleGlobalFolderSortChange = (nextSortMode: WorkspaceFolderSortMode) => {
    setGlobalFolderSortMode((currentSortMode) =>
      currentSortMode === nextSortMode ? null : nextSortMode,
    );
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
    const destinationOptions = buildFolderOptions(workspaceTree, new Set([folderToMove.id, ...collectDescendantFolderIds(folderToMove)]));
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
  const openProjectFolderModal = (folderId: string) => {
    const folder = findFolderById(workspaceTree, folderId);
    if (!folder) return;
    setFolderOperationError('');
    setProjectFolderState({
      folderId,
      folderName: folder.name,
      projectUrl: folder.source?.kind === 'project' ? folder.source.projectUrl : '',
    });
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
  const openDeleteConversationModal = (conversationId: string) => {
    const conversationToDelete = conversations.find((conversation) => conversation.id === conversationId);
    if (!conversationToDelete) return;
    setFolderOperationError('');
    setDeleteConversationState({
      conversationId,
      conversationTitle: conversationToDelete.title,
    });
  };

  const deleteFolder = (folderId: string) => {
    const removalResult = removeFolderFromTree(workspaceTree, folderId);
    if (!removalResult.removedFolder) return;

    const removedConversationIds = collectConversationIds([removalResult.removedFolder]);
    const removedFolderIds = [removalResult.removedFolder.id, ...collectDescendantFolderIds(removalResult.removedFolder)];
    const nextConversations = conversations.filter((conversation) => !removedConversationIds.includes(conversation.id));
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

  const deleteConversation = (conversationId: string) => {
    const conversationNodeId = findConversationNodeId(workspaceTree, conversationId);
    if (!conversationNodeId) return;

    const removalResult = removeNodeFromTree(workspaceTree, conversationNodeId);
    if (!removalResult.removedNode) return;

    const nextConversations = conversations.filter((conversation) => conversation.id !== conversationId);
    const nextActiveConversationId = nextConversations.some(
      (conversation) => conversation.id === activeConversationId,
    )
      ? activeConversationId
      : findFirstConversationId(removalResult.tree) || nextConversations[0]?.id || '';

    removeConversationScrollState([conversationId]);
    setSourceDrawer(null);
    setConversations(nextConversations);
    setWorkspaceTree(removalResult.tree);
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
    setWorkspaceTree((currentTree) =>
      renameFolderInTree(currentTree, renameFolderState.folderId, nextName),
    );
    setFolderOperationError('');
    setRenameFolderState(null);
  };

  const handleProjectFolderSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectFolderState) return;
    const normalizedProjectUrl = normalizeProjectUrl(projectFolderState.projectUrl);
    if (!normalizedProjectUrl) return setFolderOperationError('올바른 ChatGPT 프로젝트 URL을 입력해 주세요.');
    setWorkspaceTree((currentTree) =>
      updateFolderSourceInTree(currentTree, projectFolderState.folderId, {
        kind: 'project',
        projectUrl: normalizedProjectUrl,
      }),
    );
    setFolderOperationError('');
    setProjectFolderState(null);
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
    deleteConversationState,
    deleteConversation,
    deleteFolder,
    deleteFolderState,
    folderOperationError,
    globalFolderSortMode,
    handleConversationSelect,
    handleCreateFolderSubmit,
    handleFolderDeleteRequest,
    handleFolderToggle,
    handleFolderSortToggle,
    handleGlobalFolderSortChange,
    handleMoveFolderSubmit,
    handleProjectFolderSubmit,
    handleRenameConversationSubmit,
    handleRenameFolderSubmit,
    handleTreeNodeDrop,
    handleTreeNodeReorder,
    moveFolderOptions,
    moveFolderState,
    openCreateFolderModal,
    openDeleteConversationModal,
    openMoveFolderModal,
    openProjectFolderModal,
    openRenameConversationModal,
    openRenameFolderModal,
    projectFolderState,
    renameConversationState,
    renameFolderState,
    setCreateFolderState,
    setDeleteConversationState,
    setDeleteFolderState,
    setMoveFolderState,
    setProjectFolderState,
    setRenameConversationState,
    setRenameFolderState,
  };
}
