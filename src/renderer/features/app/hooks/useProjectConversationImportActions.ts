import { useEffect, useRef, useState, type Dispatch, type SetStateAction, type MutableRefObject, type FormEvent } from 'react';
import type { ProjectConversationImportFailure, ProjectConversationImportMode, ProjectConversationImportProgress, ProjectConversationLink, ProjectConversationSyncSummary } from '../../../../shared/import/projectConversationImport';
import type { Conversation, SourceDrawerState, WorkspaceNode } from '../../../types/chat';
import { normalizeProjectUrl } from '../lib/sharedConversationUtils';
import { getRetryableProjectConversationFailures } from '../lib/projectConversationImportHelpers';
import { runProjectConversationImportWorkflow } from '../lib/projectConversationImportWorkflow';
import { retryProjectConversationImportWorkflow } from '../lib/projectConversationRetryWorkflow';
import {
  loadProjectConversationImportPreferences,
  saveProjectConversationImportPreferences,
  type ProjectConversationImportStrategyPreference,
} from '../lib/projectConversationImportPreferences';

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
  const normalizeWorkerCount = (workerCount: number) => {
    if (!Number.isFinite(workerCount)) {
      return 10;
    }
    return Math.min(20, Math.max(1, Math.round(workerCount)));
  };

  const [projectImportPreferences, setProjectImportPreferences] = useState(() =>
    loadProjectConversationImportPreferences(),
  );
  const [isProjectImportModalOpen, setIsProjectImportModalOpen] = useState(false);
  const [isImportingProjectConversations, setIsImportingProjectConversations] =
    useState(false);
  const [projectImportError, setProjectImportError] = useState('');
  const [projectImportMode, setProjectImportMode] = useState<ProjectConversationImportMode>('import');
  const [projectImportProgress, setProjectImportProgress] = useState<ProjectConversationImportProgress | null>(null);
  const [projectImportFailures, setProjectImportFailures] = useState<ProjectConversationImportFailure[]>([]);
  const [projectSyncSummary, setProjectSyncSummary] = useState<ProjectConversationSyncSummary | null>(null);
  const [projectImportUrl, setProjectImportUrl] = useState('');
  const [projectImportParentFolderId, setProjectImportParentFolderId] = useState<string | null>(null);
  const [retryingFailureChatUrl, setRetryingFailureChatUrl] = useState('');
  const projectImportContextRef = useRef<{ folderId: string; importStartedAt: number; projectUrl: string } | null>(null);
  const projectImportTargetFolderIdRef = useRef<string | null>(null);
  const projectCollectedConversationsRef = useRef<ProjectConversationLink[]>([]);
  const projectConversationIdByUrlRef = useRef<Map<string, string>>(new Map());
  const importedProjectConversationUrlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (isProjectImportModalOpen) {
      return;
    }
    setIsImportingProjectConversations(false);
    setProjectImportError('');
    setProjectImportMode('import');
    setProjectImportFailures([]);
    setProjectImportProgress(null);
    setProjectSyncSummary(null);
    setProjectImportUrl('');
    setProjectImportParentFolderId(null);
    setRetryingFailureChatUrl('');
    projectImportContextRef.current = null;
    projectImportTargetFolderIdRef.current = null;
    projectCollectedConversationsRef.current = [];
    projectConversationIdByUrlRef.current = new Map();
    importedProjectConversationUrlsRef.current = new Set();
  }, [isProjectImportModalOpen]);

  useEffect(() => {
    if (!window.electronAPI?.onProjectConversationImportProgress) return undefined;
    return window.electronAPI.onProjectConversationImportProgress(setProjectImportProgress);
  }, []);

  useEffect(() => {
    saveProjectConversationImportPreferences(projectImportPreferences);
  }, [projectImportPreferences]);

  const cleanupBackgroundAutomationPool = async () => {
    await window.electronAPI?.cleanupChatGptAutomationBackgroundPool();
  };

  const handleImportProjectConversations = async (event: FormEvent<HTMLFormElement>) => {
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
    setProjectImportFailures([]);
    setProjectImportProgress(null);
    setProjectSyncSummary(null);
    setIsImportingProjectConversations(true);
    try {
      await runProjectConversationImportWorkflow({
        conversations,
        importedProjectConversationUrlsRef,
        messageHeightCacheRef,
        normalizedProjectUrl,
        projectCollectedConversationsRef,
        projectConversationIdByUrlRef,
        projectImportContextRef,
        projectImportMode,
        projectImportParentFolderId,
        projectImportPreferences,
        projectImportTargetFolderId: projectImportTargetFolderIdRef.current,
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
      });
    } catch (error) {
      setProjectImportError(
        error instanceof Error
          ? error.message
          : '프로젝트 대화를 불러오지 못했습니다.',
      );
    } finally {
      setIsImportingProjectConversations(false);
      await cleanupBackgroundAutomationPool();
    }
  };

  const handleRetryProjectConversationFailure = async (
    chatUrl: string,
    cleanupAfterRetry = true,
  ) => {
    if (isImportingProjectConversations || retryingFailureChatUrl) {
      return;
    }
    const failure = projectImportFailures.find((item) => item.chatUrl === chatUrl);
    if (!projectImportContextRef.current || !failure || failure.status === 'failed') {
      return;
    }

    setRetryingFailureChatUrl(chatUrl);
    try {
      await retryProjectConversationImportWorkflow({
        conversations,
        failure,
        importedProjectConversationUrlsRef,
        messageHeightCacheRef,
        projectCollectedConversationsRef,
        projectConversationIdByUrlRef,
        projectImportContextRef,
        projectImportFailures,
        projectImportMode,
        projectImportPreferences,
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
      });
    } finally {
      setRetryingFailureChatUrl('');
      if (cleanupAfterRetry) {
        await cleanupBackgroundAutomationPool();
      }
    }
  };

  const handleRetryAllProjectConversationFailures = async () => {
    const retryableFailures = getRetryableProjectConversationFailures(projectImportFailures);
    try {
      for (const failure of retryableFailures) {
        await handleRetryProjectConversationFailure(failure.chatUrl, false);
      }
    } finally {
      await cleanupBackgroundAutomationPool();
    }
  };

  const openProjectImportModal = () => {
    projectImportTargetFolderIdRef.current = null;
    setProjectImportMode('import');
    setProjectImportError('');
    setProjectImportUrl('');
    setProjectImportParentFolderId(null);
    setProjectSyncSummary(null);
    setIsProjectImportModalOpen(true);
  };

  const setProjectImportWorkerCount = (workerCount: number) => {
    setProjectImportPreferences((current) => ({
      ...current,
      workerCount: normalizeWorkerCount(workerCount),
    }));
  };

  const setProjectImportPreferredStrategy = (
    preferredStrategy: ProjectConversationImportStrategyPreference,
  ) => {
    setProjectImportPreferences((current) => ({
      ...current,
      preferredStrategy,
    }));
  };

  const openProjectFolderSync = (folderId: string, projectUrl: string) => {
    projectImportTargetFolderIdRef.current = folderId;
    setProjectImportMode('sync');
    setProjectImportError('');
    setProjectImportUrl(projectUrl);
    setProjectImportParentFolderId(null);
    setProjectSyncSummary(null);
    setIsProjectImportModalOpen(true);
  };

  return {
    canRetryAllProjectConversationFailures: getRetryableProjectConversationFailures(projectImportFailures).length > 0,
    handleImportProjectConversations,
    handleRetryAllProjectConversationFailures,
    handleRetryProjectConversationFailure,
    openProjectImportModal,
    openProjectFolderSync,
    isImportingProjectConversations,
    isProjectImportModalOpen,
    projectImportError,
    projectImportMode,
    projectImportFailures,
    projectImportProgress,
    projectImportParentFolderId,
    projectImportPreferredStrategy: projectImportPreferences.preferredStrategy,
    projectImportUrl,
    projectImportWorkerCount: projectImportPreferences.workerCount,
    projectSyncSummary,
    retryingProjectConversationUrl: retryingFailureChatUrl,
    setIsProjectImportModalOpen,
    setProjectImportParentFolderId,
    setProjectImportPreferredStrategy,
    setProjectImportUrl,
    setProjectImportWorkerCount,
  };
}
