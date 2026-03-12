import { useEffect, useState } from 'react';
import { canDropNodeInFolder, canMoveNodeRelativeToTarget, countTreeItems } from './features/conversations/lib/workspaceTree';
import { SourceDrawer } from './features/messages/components/SourceDrawer';
import type { ClearLocalWorkspaceState } from './features/app/lib/appTypes';
import { useDrawerState } from './features/app/hooks/useDrawerState';
import { useAppSettingsActions } from './features/app/hooks/useAppSettingsActions';
import { useGoogleDriveSync } from './features/app/hooks/useGoogleDriveSync';
import { useSourcePreviewState } from './features/app/hooks/useSourcePreviewState';
import { useWorkspaceActions } from './features/app/hooks/useWorkspaceActions';
import { useWorkspaceSnapshotState } from './features/app/hooks/useWorkspaceSnapshotState';
import { ConversationViewer } from './features/app/components/ConversationViewer';
import { WorkspaceSidebar } from './features/app/components/WorkspaceSidebar';
import { AppSettingsModal } from './features/app/components/modals/AppSettingsModal';
import { GoogleDriveModals } from './features/app/components/modals/GoogleDriveModals';
import { ProjectConversationImportModal } from './features/app/components/modals/ProjectConversationImportModal';
import { SharedConversationImportModal } from './features/app/components/modals/SharedConversationImportModal';
import { SharedConversationRefreshConfigModal } from './features/app/components/modals/SharedConversationRefreshConfigModal';
import { WorkspaceModals } from './features/app/components/modals/WorkspaceModals';

function AppContent() {
  const [clearLocalWorkspaceState, setClearLocalWorkspaceState] = useState<ClearLocalWorkspaceState | null>(null);
  const [conversationRenderNonce, setConversationRenderNonce] = useState(0);
  const appSettings = useAppSettingsActions();
  const drawer = useDrawerState();
  const sourceState = useSourcePreviewState();
  const workspaceState = useWorkspaceSnapshotState({ clearSourceState: sourceState.clearSourceState });
  const workspaceActions = useWorkspaceActions({
    activeConversation: workspaceState.activeConversation,
    activeConversationId: workspaceState.activeConversationId,
    conversations: workspaceState.conversations,
    messageHeightCacheRef: sourceState.messageHeightCacheRef,
    removeConversationScrollState: sourceState.removeConversationScrollState,
    setActiveConversationId: workspaceState.setActiveConversationId,
    setConversations: workspaceState.setConversations,
    setExpandedFolderState: workspaceState.setExpandedFolderState,
    setSourceDrawer: sourceState.setSourceDrawer,
    setWorkspaceTree: workspaceState.setWorkspaceTree,
    workspaceTree: workspaceState.workspaceTree,
  });
  const googleDriveSync = useGoogleDriveSync({
    getLatestWorkspaceSnapshot: workspaceState.getLatestWorkspaceSnapshot,
    latestWorkspaceSnapshotSavedAt: workspaceState.latestWorkspaceSnapshotSavedAt,
    restoreWorkspaceSnapshot: workspaceState.restoreWorkspaceSnapshot,
  });

  useEffect(() => {
    sourceState.setSourceDrawer(null);
  }, [sourceState.setSourceDrawer, workspaceState.activeConversationId]);

  const handleClearLocalWorkspace = () => {
    sourceState.clearSourceState();
    workspaceState.applyPersistedWorkspaceState(workspaceState.createEmptyWorkspaceState(), new Date().toISOString());
    googleDriveSync.markLocalWorkspaceCleared();
    setClearLocalWorkspaceState(null);
  };

  return (
    <main
      ref={drawer.workspaceRef}
      className={`workspace${sourceState.sourceDrawer ? ' workspace--with-source-drawer' : ''}${drawer.isDrawerCollapsed ? ' workspace--drawer-collapsed' : ''}${drawer.isResizingDrawer ? ' workspace--resizing-drawer' : ''}`}
    >
      <WorkspaceSidebar
        activeConversationId={workspaceState.activeConversation?.id ?? ''}
        canDropNode={(nodeId, destinationFolderId) =>
          canDropNodeInFolder(workspaceState.workspaceTree, nodeId, destinationFolderId)
        }
        canReorderNode={(nodeId, targetNodeId, position) =>
          canMoveNodeRelativeToTarget(workspaceState.workspaceTree, nodeId, targetNodeId, position)
        }
        conversations={workspaceState.conversations}
        expandedFolderState={workspaceState.expandedFolderState}
        googleDrivePanelProps={{
          googleDriveErrorLink: googleDriveSync.googleDriveErrorLink,
          googleDriveErrorMessage: googleDriveSync.googleDriveErrorMessage,
          googleDriveSyncStatus: googleDriveSync.googleDriveSyncStatus,
          isGoogleDriveAutoSyncing: googleDriveSync.isGoogleDriveAutoSyncing,
          isGoogleDriveBusy: googleDriveSync.isGoogleDriveBusy,
          isLocalRestorePending: googleDriveSync.isLocalRestorePending,
          onOpenGoogleDriveConfig: googleDriveSync.openGoogleDriveConfigModal,
          onRestore: googleDriveSync.handleGoogleDriveRestore,
          onSignIn: googleDriveSync.handleGoogleDriveSignIn,
          onSyncNow: googleDriveSync.handleGoogleDriveSyncNow,
        }}
        isCollapsed={drawer.isDrawerCollapsed}
        onOpenAppSettings={appSettings.openAppSettingsModal}
        onConversationSelect={workspaceActions.handleConversationSelect}
        onCreateFolder={workspaceActions.openCreateFolderModal}
        onDeleteConversation={workspaceActions.openDeleteConversationModal}
        onDeleteFolder={workspaceActions.handleFolderDeleteRequest}
        onGlobalFolderSortChange={workspaceActions.handleGlobalFolderSortChange}
        onFolderSortToggle={workspaceActions.handleFolderSortToggle}
        onFolderToggle={workspaceActions.handleFolderToggle}
        onImportOpen={() => workspaceActions.setIsImportModalOpen(true)}
        onProjectImportOpen={workspaceActions.openProjectImportModal}
        onMoveFolder={workspaceActions.openMoveFolderModal}
        onNodeDrop={workspaceActions.handleTreeNodeDrop}
        onNodeReorder={workspaceActions.handleTreeNodeReorder}
        onProjectFolder={workspaceActions.openProjectFolderModal}
        onRenameConversation={workspaceActions.openRenameConversationModal}
        onRenameFolder={workspaceActions.openRenameFolderModal}
        onSyncProjectFolder={workspaceActions.openProjectFolderSync}
        onThemeToggle={workspaceState.toggleThemeMode}
        globalFolderSortMode={workspaceActions.globalFolderSortMode}
        themeMode={workspaceState.themeMode}
        tree={workspaceState.workspaceTree}
      />

      <div
        className={`drawer-resizer${drawer.isResizingDrawer ? ' is-active' : ''}`}
        role="separator"
        aria-orientation="vertical"
        onMouseDown={drawer.handleDrawerResizeStart}
      />

      <ConversationViewer
        activeConversation={workspaceState.activeConversation}
        initialMessageHeights={
          workspaceState.activeConversation ? sourceState.messageHeightCacheRef.current[workspaceState.activeConversation.id] : undefined
        }
        initialScrollTop={
          workspaceState.activeConversation ? sourceState.messageScrollPositionsRef.current[workspaceState.activeConversation.id] : undefined
        }
        onClearConversation={workspaceActions.openClearConversationModal}
        onMessageHeightChange={sourceState.handleMessageHeightChange}
        onOpenRefreshSettings={workspaceActions.openRefreshConfigModal}
        onRefreshConversation={workspaceActions.handleRefreshActiveConversation}
        onRerenderConversation={() =>
          setConversationRenderNonce((currentNonce) => currentNonce + 1)
        }
        onScrollPositionChange={sourceState.handleMessageListScrollPositionChange}
        onSourcePreviewNeeded={sourceState.loadSourcePreview}
        onToggleSourceDrawer={sourceState.toggleSourceDrawer}
        onSendMessage={workspaceActions.handleSendMessageToActiveConversation}
        isSendingMessage={workspaceActions.isSendingMessage}
        refreshError={workspaceActions.refreshError}
        refreshingConversationId={workspaceActions.refreshingConversationId}
        renderNonce={conversationRenderNonce}
        sourceDrawerMessageId={sourceState.sourceDrawer?.messageId}
        sourcePreviewCache={sourceState.sourcePreviewCache}
        sourcePreviewLoading={sourceState.sourcePreviewLoading}
        themeMode={workspaceState.themeMode}
      />

      <SourceDrawer
        sourceDrawer={sourceState.sourceDrawer}
        sourcePreviewCache={sourceState.sourcePreviewCache}
        sourcePreviewLoading={sourceState.sourcePreviewLoading}
        onClose={() => sourceState.setSourceDrawer(null)}
      />

      <SharedConversationImportModal
        allFolderOptions={workspaceState.allFolderOptions}
        importChatUrl={workspaceActions.importChatUrl}
        importError={workspaceActions.importError}
        importFolderId={workspaceActions.importFolderId}
        importProjectUrl={workspaceActions.importProjectUrl}
        isImportModalOpen={workspaceActions.isImportModalOpen}
        isImportingSharedConversation={workspaceActions.isImportingSharedConversation}
        onChatUrlChange={workspaceActions.setImportChatUrl}
        onClose={() => workspaceActions.setIsImportModalOpen(false)}
        onFolderChange={workspaceActions.setImportFolderId}
        onProjectUrlChange={workspaceActions.setImportProjectUrl}
        onPreferredStrategyChange={workspaceActions.setSharedImportPreferredStrategy}
        onShareUrlChange={workspaceActions.setShareUrl}
        onSubmit={workspaceActions.handleImportSharedConversation}
        preferredStrategy={workspaceActions.sharedImportPreferredStrategy}
        shareUrl={workspaceActions.shareUrl}
      />

      <ProjectConversationImportModal
        allFolderOptions={workspaceState.allFolderOptions}
        canRetryAllFailures={workspaceActions.canRetryAllProjectConversationFailures}
        importError={workspaceActions.projectImportError}
        failures={workspaceActions.projectImportFailures}
        isBusy={
          workspaceActions.isImportingProjectConversations ||
          !!workspaceActions.retryingProjectConversationUrl
        }
        isImporting={workspaceActions.isImportingProjectConversations}
        isOpen={
          workspaceActions.isProjectImportModalOpen ||
          workspaceActions.isImportingProjectConversations
        }
        mode={workspaceActions.projectImportMode}
        onClose={() => workspaceActions.setIsProjectImportModalOpen(false)}
        onParentFolderChange={workspaceActions.setProjectImportParentFolderId}
        onProjectUrlChange={workspaceActions.setProjectImportUrl}
        onRetryAllFailures={workspaceActions.handleRetryAllProjectConversationFailures}
        onRetryFailure={workspaceActions.handleRetryProjectConversationFailure}
        onPreferredStrategyChange={workspaceActions.setProjectImportPreferredStrategy}
        onSubmit={workspaceActions.handleImportProjectConversations}
        parentFolderId={workspaceActions.projectImportParentFolderId}
        preferredStrategy={workspaceActions.projectImportPreferredStrategy}
        progress={workspaceActions.projectImportProgress}
        projectUrl={workspaceActions.projectImportUrl}
        syncSummary={workspaceActions.projectSyncSummary}
        workerCount={workspaceActions.projectImportWorkerCount}
        onWorkerCountChange={workspaceActions.setProjectImportWorkerCount}
      />

      <SharedConversationRefreshConfigModal
        onClose={() => workspaceActions.setRefreshConfigState(null)}
        onStateChange={workspaceActions.setRefreshConfigState}
        onSubmit={workspaceActions.handleRefreshConfigSubmit}
        refreshConfigState={workspaceActions.refreshConfigState}
      />

      <WorkspaceModals
        allFolderOptions={workspaceState.allFolderOptions}
        clearLocalWorkspaceState={clearLocalWorkspaceState}
        createFolderState={workspaceActions.createFolderState}
        clearConversationState={workspaceActions.clearConversationState}
        deleteConversationState={workspaceActions.deleteConversationState}
        deleteFolderState={workspaceActions.deleteFolderState}
        folderOperationError={workspaceActions.folderOperationError}
        moveFolderOptions={workspaceActions.moveFolderOptions}
        moveFolderState={workspaceActions.moveFolderState}
        onClearLocalWorkspace={handleClearLocalWorkspace}
        onCloseClearLocalWorkspace={() => setClearLocalWorkspaceState(null)}
        onCloseClearConversation={() => workspaceActions.setClearConversationState(null)}
        onCloseCreateFolder={() => workspaceActions.setCreateFolderState(null)}
        onCloseDeleteConversation={() => workspaceActions.setDeleteConversationState(null)}
        onCloseDeleteFolder={() => workspaceActions.setDeleteFolderState(null)}
        onCloseMoveFolder={() => workspaceActions.setMoveFolderState(null)}
        onCloseProjectFolder={() => workspaceActions.setProjectFolderState(null)}
        onCloseRenameConversation={() => workspaceActions.setRenameConversationState(null)}
        onCloseRenameFolder={() => workspaceActions.setRenameFolderState(null)}
        onConfirmDeleteConversation={(conversationId) => {
          workspaceActions.deleteConversation(conversationId);
          workspaceActions.setDeleteConversationState(null);
        }}
        onConfirmClearConversation={(conversationId) => {
          workspaceActions.clearConversationContent(conversationId);
          workspaceActions.setClearConversationState(null);
        }}
        onConfirmDeleteFolder={(folderId) => {
          workspaceActions.deleteFolder(folderId);
          workspaceActions.setDeleteFolderState(null);
        }}
        onCreateFolderStateChange={workspaceActions.setCreateFolderState}
        onCreateFolderSubmit={workspaceActions.handleCreateFolderSubmit}
        onMoveFolderStateChange={workspaceActions.setMoveFolderState}
        onMoveFolderSubmit={workspaceActions.handleMoveFolderSubmit}
        onProjectFolderStateChange={workspaceActions.setProjectFolderState}
        onProjectFolderSubmit={workspaceActions.handleProjectFolderSubmit}
        onRenameConversationStateChange={workspaceActions.setRenameConversationState}
        onRenameConversationSubmit={workspaceActions.handleRenameConversationSubmit}
        onRenameFolderStateChange={workspaceActions.setRenameFolderState}
        onRenameFolderSubmit={workspaceActions.handleRenameFolderSubmit}
        projectFolderState={workspaceActions.projectFolderState}
        renameConversationState={workspaceActions.renameConversationState}
        renameFolderState={workspaceActions.renameFolderState}
      />

      <AppSettingsModal
        chatGptSessionError={appSettings.chatGptSessionError}
        chatGptSessionNotice={appSettings.chatGptSessionNotice}
        isOpen={appSettings.isAppSettingsModalOpen}
        isResettingChatGptSession={appSettings.isResettingChatGptSession}
        isResettingMermaidCache={appSettings.isResettingMermaidCache}
        mermaidCacheError={appSettings.mermaidCacheError}
        mermaidCacheNotice={appSettings.mermaidCacheNotice}
        onClose={appSettings.closeAppSettingsModal}
        onResetMermaidCache={appSettings.handleResetMermaidCache}
        onResetChatGptSessionState={appSettings.handleResetChatGptSessionState}
      />

      <GoogleDriveModals
        googleDriveAutoSyncIntervalLabel={googleDriveSync.googleDriveAutoSyncIntervalLabel}
        googleDriveAutoSyncIntervalMs={googleDriveSync.googleDriveAutoSyncIntervalMs}
        googleDriveConfigError={googleDriveSync.googleDriveConfigError}
        googleDriveConfigForm={googleDriveSync.googleDriveConfigForm}
        googleDriveErrorLink={googleDriveSync.googleDriveErrorLink}
        googleDriveErrorMessage={googleDriveSync.googleDriveErrorMessage}
        googleDriveSyncStatus={googleDriveSync.googleDriveSyncStatus}
        isGoogleDriveAutoSyncing={googleDriveSync.isGoogleDriveAutoSyncing}
        isGoogleDriveBusy={googleDriveSync.isGoogleDriveBusy}
        isGoogleDriveConfigModalOpen={googleDriveSync.isGoogleDriveConfigModalOpen}
        isLocalRestorePending={googleDriveSync.isLocalRestorePending}
        isSavingGoogleDriveConfig={googleDriveSync.isSavingGoogleDriveConfig}
        onAutoSyncIntervalChange={googleDriveSync.handleGoogleDriveAutoSyncIntervalChange}
        onClearLocalWorkspace={() => setClearLocalWorkspaceState(countTreeItems(workspaceState.workspaceTree))}
        onCloseGoogleDriveConfig={googleDriveSync.closeGoogleDriveConfigModal}
        onDisconnect={googleDriveSync.handleGoogleDriveDisconnect}
        onDismissSyncConflict={googleDriveSync.handleDismissSyncConflict}
        onGoogleDriveConfigFormChange={googleDriveSync.setGoogleDriveConfigForm}
        onGoogleDriveConfigSave={googleDriveSync.handleGoogleDriveConfigSave}
        onGoogleDriveRestore={googleDriveSync.handleGoogleDriveRestore}
        onKeepLocalSnapshot={googleDriveSync.handleKeepLocalSnapshot}
        onSignIn={googleDriveSync.handleGoogleDriveSignIn}
        onSignOut={googleDriveSync.handleGoogleDriveSignOut}
        onSyncNow={googleDriveSync.handleGoogleDriveSyncNow}
        syncConflictState={googleDriveSync.syncConflictState}
      />
    </main>
  );
}

export default AppContent;
