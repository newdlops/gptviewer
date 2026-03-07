import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceSnapshot } from '../../../../shared/sync/workspaceSnapshot';
import {
  initialConversations,
  initialWorkspaceTree,
} from '../../conversations/data/initialConversations';
import {
  loadPersistedWorkspaceSnapshot,
  loadPersistedWorkspaceState,
  savePersistedWorkspaceSnapshot,
} from '../../conversations/lib/workspacePersistence';
import {
  buildWorkspaceSnapshot,
  workspaceStateFromSnapshot,
} from '../../conversations/lib/workspaceSnapshot';
import {
  buildExpandedFolderState,
  buildFolderOptions,
  findFirstConversationId,
} from '../../conversations/lib/workspaceTree';
import { detectInitialTheme } from '../../../lib/theme';
import type {
  Conversation,
  ThemeMode,
  WorkspaceNode,
} from '../../../types/chat';
import { INITIAL_ACTIVE_CONVERSATION_ID } from '../lib/appTypes';

type UseWorkspaceSnapshotStateArgs = {
  clearSourceState: () => void;
};

const fallbackInitialState = {
  activeConversationId:
    findFirstConversationId(initialWorkspaceTree) ||
    INITIAL_ACTIVE_CONVERSATION_ID,
  conversations: initialConversations,
  expandedFolderState: buildExpandedFolderState(initialWorkspaceTree),
  workspaceTree: initialWorkspaceTree,
};

export function useWorkspaceSnapshotState({
  clearSourceState,
}: UseWorkspaceSnapshotStateArgs) {
  const initialWorkspaceSnapshotRef = useRef(loadPersistedWorkspaceSnapshot());
  const initialWorkspaceStateRef = useRef(
    initialWorkspaceSnapshotRef.current
      ? workspaceStateFromSnapshot(initialWorkspaceSnapshotRef.current)
      : loadPersistedWorkspaceState() ?? fallbackInitialState,
  );
  const [conversations, setConversations] = useState(
    initialWorkspaceStateRef.current.conversations,
  );
  const [workspaceTree, setWorkspaceTree] = useState<WorkspaceNode[]>(
    initialWorkspaceStateRef.current.workspaceTree,
  );
  const [expandedFolderState, setExpandedFolderState] = useState<
    Record<string, boolean>
  >(initialWorkspaceStateRef.current.expandedFolderState);
  const [activeConversationId, setActiveConversationId] = useState(
    initialWorkspaceStateRef.current.activeConversationId,
  );
  const [themeMode, setThemeMode] = useState<ThemeMode>(detectInitialTheme);
  const [latestWorkspaceSnapshotSavedAt, setLatestWorkspaceSnapshotSavedAt] =
    useState(
      initialWorkspaceSnapshotRef.current?.savedAt ?? new Date().toISOString(),
    );
  const preservedSnapshotSavedAtRef = useRef<string | null>(
    initialWorkspaceSnapshotRef.current?.savedAt ?? null,
  );
  const latestWorkspaceSnapshotRef = useRef<WorkspaceSnapshot>(
    buildWorkspaceSnapshot(
      initialWorkspaceStateRef.current,
      initialWorkspaceSnapshotRef.current?.savedAt ?? new Date().toISOString(),
    ),
  );

  const activeConversation = useMemo(
    () =>
      conversations.find(
        (conversation) => conversation.id === activeConversationId,
      ) ?? null,
    [activeConversationId, conversations],
  );

  const allFolderOptions = useMemo(
    () => buildFolderOptions(workspaceTree),
    [workspaceTree],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.style.colorScheme = themeMode;
    window.localStorage.setItem('theme-mode', themeMode);
  }, [themeMode]);

  useEffect(() => {
    const nextSnapshot = buildWorkspaceSnapshot(
      {
        activeConversationId,
        conversations,
        expandedFolderState,
        workspaceTree,
      },
      preservedSnapshotSavedAtRef.current ?? new Date().toISOString(),
    );

    preservedSnapshotSavedAtRef.current = null;
    latestWorkspaceSnapshotRef.current = nextSnapshot;
    setLatestWorkspaceSnapshotSavedAt(nextSnapshot.savedAt);
    savePersistedWorkspaceSnapshot(nextSnapshot);
  }, [activeConversationId, conversations, expandedFolderState, workspaceTree]);

  const getLatestWorkspaceSnapshot = (): WorkspaceSnapshot =>
    latestWorkspaceSnapshotRef.current ??
    buildWorkspaceSnapshot({
      activeConversationId,
      conversations,
      expandedFolderState,
      workspaceTree,
    });

  const applyPersistedWorkspaceState = (
    nextState: ReturnType<typeof workspaceStateFromSnapshot>,
    preservedSavedAt?: string,
  ) => {
    if (preservedSavedAt) {
      preservedSnapshotSavedAtRef.current = preservedSavedAt;
    }

    clearSourceState();
    setConversations(nextState.conversations);
    setWorkspaceTree(nextState.workspaceTree);
    setExpandedFolderState(nextState.expandedFolderState);
    setActiveConversationId(nextState.activeConversationId);
  };

  const createEmptyWorkspaceState = () => ({
    activeConversationId: '',
    conversations: [] as Conversation[],
    expandedFolderState: {} as Record<string, boolean>,
    workspaceTree: [] as WorkspaceNode[],
  });

  const restoreWorkspaceSnapshot = (snapshot: WorkspaceSnapshot) => {
    applyPersistedWorkspaceState(workspaceStateFromSnapshot(snapshot), snapshot.savedAt);
  };

  const toggleThemeMode = () => {
    setThemeMode((currentTheme) =>
      currentTheme === 'dark' ? 'light' : 'dark',
    );
  };

  return {
    activeConversation,
    activeConversationId,
    allFolderOptions,
    applyPersistedWorkspaceState,
    conversations,
    createEmptyWorkspaceState,
    expandedFolderState,
    getLatestWorkspaceSnapshot,
    latestWorkspaceSnapshotSavedAt,
    restoreWorkspaceSnapshot,
    setActiveConversationId,
    setConversations,
    setExpandedFolderState,
    setThemeMode,
    setWorkspaceTree,
    themeMode,
    toggleThemeMode,
    workspaceTree,
  };
}
