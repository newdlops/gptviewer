import { contextBridge, ipcRenderer } from 'electron';
import type { GoogleDriveConfigInput } from '../shared/sync/googleDriveSync';
import type { SharedConversationRefreshRequest } from '../shared/refresh/sharedConversationRefresh';
import type { WorkspaceSnapshot } from '../shared/sync/workspaceSnapshot';

contextBridge.exposeInMainWorld('electronAPI', {
  fetchSourceIcon: (iconUrl: string, refererUrl?: string) =>
    ipcRenderer.invoke('source-icon:fetch', iconUrl, refererUrl),
  fetchSharedConversation: (url: string) =>
    ipcRenderer.invoke('shared-conversation:fetch', url),
  refreshSharedConversation: (request: SharedConversationRefreshRequest) =>
    ipcRenderer.invoke('shared-conversation:refresh', request),
  fetchSourcePreview: (url: string) =>
    ipcRenderer.invoke('source-preview:fetch', url),
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
