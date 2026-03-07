import { useEffect, useState } from 'react';
import { canDropNodeInFolder, canMoveNodeRelativeToTarget, countTreeItems } from './features/conversations/lib/workspaceTree';
import { SourceDrawer } from './features/messages/components/SourceDrawer';
import type { ClearLocalWorkspaceState } from './features/app/lib/appTypes';
import { useDrawerState } from './features/app/hooks/useDrawerState';
import { useGoogleDriveSync } from './features/app/hooks/useGoogleDriveSync';
import { useSourcePreviewState } from './features/app/hooks/useSourcePreviewState';
import { useWorkspaceActions } from './features/app/hooks/useWorkspaceActions';
import { useWorkspaceSnapshotState } from './features/app/hooks/useWorkspaceSnapshotState';
import { ConversationViewer } from './features/app/components/ConversationViewer';
import { WorkspaceSidebar } from './features/app/components/WorkspaceSidebar';
import { GoogleDriveModals } from './features/app/components/modals/GoogleDriveModals';
import { SharedConversationImportModal } from './features/app/components/modals/SharedConversationImportModal';
import { SharedConversationRefreshConfigModal } from './features/app/components/modals/SharedConversationRefreshConfigModal';
import { WorkspaceModals } from './features/app/components/modals/WorkspaceModals';

function AppContent() {
  const [clearLocalWorkspaceState, setClearLocalWorkspaceState] = useState<ClearLocalWorkspaceState | null>(null);
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

  const hasImportDestinationFolders = workspaceState.allFolderOptions.length > 0;

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
          googleDriveAutoSyncIntervalLabel: googleDriveSync.googleDriveAutoSyncIntervalLabel,
          googleDriveAutoSyncIntervalMs: googleDriveSync.googleDriveAutoSyncIntervalMs,
          googleDriveErrorLink: googleDriveSync.googleDriveErrorLink,
          googleDriveErrorMessage: googleDriveSync.googleDriveErrorMessage,
          googleDriveSyncStatus: googleDriveSync.googleDriveSyncStatus,
          isGoogleDriveAutoSyncing: googleDriveSync.isGoogleDriveAutoSyncing,
          isGoogleDriveBusy: googleDriveSync.isGoogleDriveBusy,
          isLocalRestorePending: googleDriveSync.isLocalRestorePending,
          onAutoSyncIntervalChange: googleDriveSync.handleGoogleDriveAutoSyncIntervalChange,
          onClearLocalWorkspace: () => setClearLocalWorkspaceState(countTreeItems(workspaceState.workspaceTree)),
          onOpenGoogleDriveConfig: googleDriveSync.openGoogleDriveConfigModal,
          onSignIn: googleDriveSync.handleGoogleDriveSignIn,
          onSignOut: googleDriveSync.handleGoogleDriveSignOut,
          onDisconnect: googleDriveSync.handleGoogleDriveDisconnect,
          onSyncNow: googleDriveSync.handleGoogleDriveSyncNow,
        }}
        isCollapsed={drawer.isDrawerCollapsed}
        onConversationSelect={workspaceActions.handleConversationSelect}
        onCreateFolder={workspaceActions.openCreateFolderModal}
        onDeleteFolder={workspaceActions.handleFolderDeleteRequest}
        onFolderToggle={workspaceActions.handleFolderToggle}
        onImportOpen={() => workspaceActions.setIsImportModalOpen(true)}
        onMoveFolder={workspaceActions.openMoveFolderModal}
        onNodeDrop={workspaceActions.handleTreeNodeDrop}
        onNodeReorder={workspaceActions.handleTreeNodeReorder}
        onRenameConversation={workspaceActions.openRenameConversationModal}
        onRenameFolder={workspaceActions.openRenameFolderModal}
        onThemeToggle={workspaceState.toggleThemeMode}
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
        onMessageHeightChange={sourceState.handleMessageHeightChange}
        onOpenRefreshSettings={workspaceActions.openRefreshConfigModal}
        onRefreshConversation={workspaceActions.handleRefreshActiveConversation}
        onScrollPositionChange={sourceState.handleMessageListScrollPositionChange}
        onSourcePreviewNeeded={sourceState.loadSourcePreview}
        onToggleSourceDrawer={sourceState.toggleSourceDrawer}
        refreshError={workspaceActions.refreshError}
        refreshingConversationId={workspaceActions.refreshingConversationId}
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
        hasImportDestinationFolders={hasImportDestinationFolders}
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
        onShareUrlChange={workspaceActions.setShareUrl}
        onSubmit={workspaceActions.handleImportSharedConversation}
        shareUrl={workspaceActions.shareUrl}
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
        deleteFolderState={workspaceActions.deleteFolderState}
        folderOperationError={workspaceActions.folderOperationError}
        moveFolderOptions={workspaceActions.moveFolderOptions}
        moveFolderState={workspaceActions.moveFolderState}
        onClearLocalWorkspace={handleClearLocalWorkspace}
        onCloseClearLocalWorkspace={() => setClearLocalWorkspaceState(null)}
        onCloseCreateFolder={() => workspaceActions.setCreateFolderState(null)}
        onCloseDeleteFolder={() => workspaceActions.setDeleteFolderState(null)}
        onCloseMoveFolder={() => workspaceActions.setMoveFolderState(null)}
        onCloseRenameConversation={() => workspaceActions.setRenameConversationState(null)}
        onCloseRenameFolder={() => workspaceActions.setRenameFolderState(null)}
        onConfirmDeleteFolder={(folderId) => {
          workspaceActions.deleteFolder(folderId);
          workspaceActions.setDeleteFolderState(null);
        }}
        onCreateFolderStateChange={workspaceActions.setCreateFolderState}
        onCreateFolderSubmit={workspaceActions.handleCreateFolderSubmit}
        onMoveFolderStateChange={workspaceActions.setMoveFolderState}
        onMoveFolderSubmit={workspaceActions.handleMoveFolderSubmit}
        onRenameConversationStateChange={workspaceActions.setRenameConversationState}
        onRenameConversationSubmit={workspaceActions.handleRenameConversationSubmit}
        onRenameFolderStateChange={workspaceActions.setRenameFolderState}
        onRenameFolderSubmit={workspaceActions.handleRenameFolderSubmit}
        renameConversationState={workspaceActions.renameConversationState}
        renameFolderState={workspaceActions.renameFolderState}
      />

      <GoogleDriveModals
        googleDriveConfigError={googleDriveSync.googleDriveConfigError}
        googleDriveConfigForm={googleDriveSync.googleDriveConfigForm}
        isGoogleDriveAutoSyncing={googleDriveSync.isGoogleDriveAutoSyncing}
        isGoogleDriveBusy={googleDriveSync.isGoogleDriveBusy}
        isGoogleDriveConfigModalOpen={googleDriveSync.isGoogleDriveConfigModalOpen}
        isSavingGoogleDriveConfig={googleDriveSync.isSavingGoogleDriveConfig}
        onCloseGoogleDriveConfig={googleDriveSync.closeGoogleDriveConfigModal}
        onDismissSyncConflict={googleDriveSync.handleDismissSyncConflict}
        onGoogleDriveConfigFormChange={googleDriveSync.setGoogleDriveConfigForm}
        onGoogleDriveConfigSave={googleDriveSync.handleGoogleDriveConfigSave}
        onGoogleDriveRestore={googleDriveSync.handleGoogleDriveRestore}
        onKeepLocalSnapshot={googleDriveSync.handleKeepLocalSnapshot}
        syncConflictState={googleDriveSync.syncConflictState}
      />
    </main>
  );
}

export default AppContent;
