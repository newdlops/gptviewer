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
  startInteractiveJava: (sessionId: string, code: string) =>
    ipcRenderer.invoke('java:start-interactive', sessionId, code),
  sendJavaInput: (sessionId: string, input: string) =>
    ipcRenderer.send('java:send-input', sessionId, input),
  stopInteractiveJava: (sessionId: string) =>
    ipcRenderer.send('java:stop-interactive', sessionId),
  onJavaRunOutput: (listener: (sessionId: string, data: string) => void) => {
    const wrappedListener = (_event: any, sid: string, data: string) => listener(sid, data);
    ipcRenderer.on('java:run-output', wrappedListener);
    return () => ipcRenderer.removeListener('java:run-output', wrappedListener);
  },
  onJavaRunError: (listener: (sessionId: string, data: string) => void) => {
    const wrappedListener = (_event: any, sid: string, data: string) => listener(sid, data);
    ipcRenderer.on('java:run-error', wrappedListener);
    return () => ipcRenderer.removeListener('java:run-error', wrappedListener);
  },
  onJavaRunExit: (listener: (sessionId: string, code: number) => void) => {
    const wrappedListener = (_event: any, sid: string, code: number) => listener(sid, code);
    ipcRenderer.on('java:run-exit', wrappedListener);
    return () => ipcRenderer.removeListener('java:run-exit', wrappedListener);
  },
  startJavaServer: (code: string) => ipcRenderer.invoke('java:lsp-start', code),
  updateJavaFile: (filePath: string, code: string) =>
    ipcRenderer.invoke('java:update-file', filePath, code),
  createJavaFile: (projectDir: string, relativePath: string, content?: string) =>
    ipcRenderer.invoke('java:create-file', projectDir, relativePath, content),
  createJavaDirectory: (projectDir: string, relativePath: string) =>
    ipcRenderer.invoke('java:create-directory', projectDir, relativePath),
  deleteJavaPath: (projectDir: string, relativePath: string) =>
    ipcRenderer.invoke('java:delete-path', projectDir, relativePath),
  renameJavaPath: (projectDir: string, oldRelativePath: string, newRelativePath: string) =>
    ipcRenderer.invoke('java:rename-path', projectDir, oldRelativePath, newRelativePath),
  getJavaProjectTree: (projectDir: string) =>
    ipcRenderer.invoke('java:get-project-tree', projectDir),
  getJavaProjectSnapshot: (projectDir: string) =>
    ipcRenderer.invoke('java:get-project-snapshot', projectDir),
  readJavaFile: (filePath: string) =>
    ipcRenderer.invoke('java:read-file', filePath),
  stopJavaServer: () => ipcRenderer.invoke('java:lsp-stop'),
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
