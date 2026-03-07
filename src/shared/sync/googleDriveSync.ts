export type GoogleDriveSyncPhase =
  | 'disabled'
  | 'error'
  | 'idle'
  | 'signed-out'
  | 'syncing';

export type GoogleDriveSyncStatus = {
  accountEmail?: string;
  hasRemoteSnapshot?: boolean;
  isConfigured: boolean;
  isSignedIn: boolean;
  lastSyncedAt?: string;
  message?: string;
  phase: GoogleDriveSyncPhase;
  provider: 'google-drive';
};

export type GoogleDriveConfigSource = 'app' | 'env' | 'file' | 'none';

export type GoogleDriveConfigSummary = {
  clientId?: string;
  hasClientSecret: boolean;
  isConfigured: boolean;
  setupUrl: string;
  source: GoogleDriveConfigSource;
};

export type GoogleDriveConfigInput = {
  clientId: string;
  clientSecret?: string;
  keepExistingClientSecret?: boolean;
};
