import type {
  ProjectConversationImportRequest,
  ProjectConversationImportResult,
} from '../../shared/import/projectConversationImport';
import type {
  GoogleDriveConfigInput,
  GoogleDriveConfigSummary,
  GoogleDriveSyncStatus,
} from '../../shared/sync/googleDriveSync';
import type {
  SharedConversationImport,
  SharedConversationRefreshRequest,
  SharedConversationRefreshResult,
} from '../../shared/refresh/sharedConversationRefresh';
import type { WorkspaceSnapshot } from '../../shared/sync/workspaceSnapshot';

interface SourcePreviewImport {
  description?: string;
  iconHref?: string;
  iconUrl?: string;
  publisher?: string;
  title?: string;
  url: string;
}

interface SourceIconImport {
  contentType?: string;
  dataUrl: string;
  finalUrl: string;
}

interface ElectronAPI {
  fetchSourceIcon(
    iconUrl: string,
    refererUrl?: string,
  ): Promise<SourceIconImport | null>;
  fetchSharedConversation(url: string): Promise<SharedConversationImport>;
  importProjectConversations(
    request: ProjectConversationImportRequest,
  ): Promise<ProjectConversationImportResult>;
  refreshSharedConversation(
    request: SharedConversationRefreshRequest,
  ): Promise<SharedConversationRefreshResult>;
  fetchSourcePreview(url: string): Promise<SourcePreviewImport>;
  getGoogleDriveConfig(): Promise<GoogleDriveConfigSummary>;
  getGoogleDriveSyncStatus(): Promise<GoogleDriveSyncStatus>;
  platform: NodeJS.Platform;
  disconnectGoogleDrive(): Promise<GoogleDriveSyncStatus>;
  downloadGoogleDriveSnapshot(): Promise<WorkspaceSnapshot | null>;
  saveGoogleDriveConfig(input: GoogleDriveConfigInput): Promise<GoogleDriveConfigSummary>;
  signInGoogleDrive(): Promise<GoogleDriveSyncStatus>;
  signOutGoogleDrive(): Promise<GoogleDriveSyncStatus>;
  syncGoogleDriveNow(snapshot: WorkspaceSnapshot): Promise<GoogleDriveSyncStatus>;
  versions: NodeJS.ProcessVersions;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
