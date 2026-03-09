import type {
  ProjectConversationCollectionResult,
  ProjectConversationImportProgress,
  ProjectConversationImportRequest,
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

interface ChatGptImageAssetImport {
  cacheKey: string;
  dataUrl: string;
  sourceUrl: string;
}

interface ElectronAPI {
  fetchSourceIcon(
    iconUrl: string,
    refererUrl?: string,
  ): Promise<SourceIconImport | null>;
  fetchSharedConversation(url: string): Promise<SharedConversationImport>;
  collectProjectConversationLinks(
    request: ProjectConversationImportRequest,
  ): Promise<ProjectConversationCollectionResult>;
  cleanupChatGptAutomationBackgroundPool(): Promise<void>;
  resetChatGptAutomationSessionState(): Promise<void>;
  onProjectConversationImportProgress(
    listener: (progress: ProjectConversationImportProgress) => void,
  ): () => void;
  refreshSharedConversation(
    request: SharedConversationRefreshRequest,
  ): Promise<SharedConversationRefreshResult>;
  importChatGptConversation(
    request: SharedConversationRefreshRequest,
  ): Promise<SharedConversationImport>;
  resolveChatGptImageAsset(
    chatUrl: string,
    assetUrl: string,
  ): Promise<ChatGptImageAssetImport | null>;
  saveImage(
    dataUrl: string,
    defaultName?: string,
  ): Promise<{ filePath?: string; success: boolean }>;
  runJavaCode(
    code: string,
  ): Promise<{ error?: string; output?: string; success: boolean }>;
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
