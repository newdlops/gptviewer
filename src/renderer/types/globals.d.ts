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
  onSharedConversationStatusUpdate(
    listener: (status: 'sending' | 'receiving' | 'idle') => void,
  ): () => void;
  refreshSharedConversation(
    request: SharedConversationRefreshRequest,
  ): Promise<SharedConversationRefreshResult>;
  sendMessageToSharedConversation(
    request: SharedConversationRefreshRequest,
    message: string,
    model?: string,
  ): Promise<SharedConversationRefreshResult>;
  getChatGptModelConfig(): Promise<any>;
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
  startInteractiveJava(sessionId: string, code: string, snapshot?: Record<string, string>): Promise<{ success: boolean; error?: string }>;
  sendJavaInput(sessionId: string, input: string): void;
  stopInteractiveJava(sessionId: string): void;
  onJavaRunOutput(listener: (sessionId: string, data: string) => void): () => void;
  onJavaRunError(listener: (sessionId: string, data: string) => void): () => void;
  onJavaRunExit(listener: (sessionId: string, code: number) => void): () => void;
  startJavaServer(code: string, snapshot?: Record<string, string>): Promise<{ success: boolean; port: number; projectDir: string; filePath: string; bundles?: string[]; error?: string }>;
  updateJavaFile(filePath: string, code: string): Promise<{ success: boolean }>;
  createJavaFile(projectDir: string, relativePath: string, content?: string): Promise<{ success: boolean, error?: string }>;
  createJavaDirectory(projectDir: string, relativePath: string): Promise<{ success: boolean, error?: string }>;
  deleteJavaPath(projectDir: string, relativePath: string): Promise<{ success: boolean, error?: string }>;
  renameJavaPath(projectDir: string, oldRelativePath: string, newRelativePath: string): Promise<{ success: boolean, error?: string }>;
  getJavaProjectTree(projectDir: string): Promise<any[]>;
  getJavaProjectSnapshot(projectDir: string): Promise<Record<string, string>>;
  readJavaFile(filePath: string): Promise<string>;
  stopJavaServer(): Promise<{ success: boolean }>;
  startJavaDebugBridge(tcpPort: number): Promise<number>;
  log(level: 'info' | 'warn' | 'error', ...args: any[]): void;
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
