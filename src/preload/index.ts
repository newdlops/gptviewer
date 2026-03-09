import { contextBridge, ipcRenderer } from 'electron';
import type {
  ProjectConversationImportProgress,
  ProjectConversationImportRequest,
} from '../shared/import/projectConversationImport';
import type { GoogleDriveConfigInput } from '../shared/sync/googleDriveSync';
import type { SharedConversationRefreshRequest } from '../shared/refresh/sharedConversationRefresh';
import type { WorkspaceSnapshot } from '../shared/sync/workspaceSnapshot';

contextBridge.exposeInMainWorld('electronAPI', {
  fetchSourceIcon: (iconUrl: string, refererUrl?: string) =>
    ipcRenderer.invoke('source-icon:fetch', iconUrl, refererUrl),
  fetchSharedConversation: (url: string) =>
    ipcRenderer.invoke('shared-conversation:fetch', url),
  collectProjectConversationLinks: (request: ProjectConversationImportRequest) =>
    ipcRenderer.invoke('project-conversation:collect', request),
  cleanupChatGptAutomationBackgroundPool: () =>
    ipcRenderer.invoke('chatgpt-automation:cleanup-background-pool'),
  resetChatGptAutomationSessionState: () =>
    ipcRenderer.invoke('chatgpt-automation:reset-session-state'),
  onProjectConversationImportProgress: (
    listener: (progress: ProjectConversationImportProgress) => void,
  ) => {
    const wrappedListener = (
      _event: Electron.IpcRendererEvent,
      progress: ProjectConversationImportProgress,
    ) => {
      listener(progress);
    };
    ipcRenderer.on('project-conversation:progress', wrappedListener);
    return () => {
      ipcRenderer.removeListener(
        'project-conversation:progress',
        wrappedListener,
      );
    };
  },
  refreshSharedConversation: (request: SharedConversationRefreshRequest) =>
    ipcRenderer.invoke('shared-conversation:refresh', request),
  importChatGptConversation: (request: SharedConversationRefreshRequest) =>
    ipcRenderer.invoke('chatgpt-conversation:import', request),
  fetchSourcePreview: (url: string) =>
    ipcRenderer.invoke('source-preview:fetch', url),
  resolveChatGptImageAsset: (chatUrl: string, assetUrl: string) =>
    ipcRenderer.invoke('chatgpt-image:resolve', chatUrl, assetUrl),
  saveImage: (dataUrl: string, defaultName?: string) =>
    ipcRenderer.invoke('image:save', dataUrl, defaultName),
  runJavaCode: (code: string) =>
    ipcRenderer.invoke('java:run', code),
  getGoogleDriveConfig: () => ipcRenderer.invoke('google-drive-sync:get-config'),
  getGoogleDriveSyncStatus: () =>
    ipcRenderer.invoke('google-drive-sync:get-status'),
  saveGoogleDriveConfig: (input: GoogleDriveConfigInput) =>
    ipcRenderer.invoke('google-drive-sync:save-config', input),
  signInGoogleDrive: () => ipcRenderer.invoke('google-drive-sync:sign-in'),
  signOutGoogleDrive: () => ipcRenderer.invoke('google-drive-sync:sign-out'),
  disconnectGoogleDrive: () => ipcRenderer.invoke('google-drive-sync:disconnect'),
  syncGoogleDriveNow: (snapshot: WorkspaceSnapshot) =>
    ipcRenderer.invoke('google-drive-sync:sync-now', snapshot),
  downloadGoogleDriveSnapshot: () =>
    ipcRenderer.invoke('google-drive-sync:download-snapshot'),
  platform: process.platform,
  versions: process.versions,
});
