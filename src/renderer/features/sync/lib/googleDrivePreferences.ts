const GOOGLE_DRIVE_PREFERENCES_STORAGE_KEY =
  'gptviewer.google-drive-preferences.v1';

export const GOOGLE_DRIVE_AUTO_SYNC_INTERVAL_OPTIONS = [
  { label: '수동', value: 0 },
  { label: '5초', value: 5_000 },
  { label: '30초', value: 30_000 },
  { label: '1분', value: 60_000 },
  { label: '5분', value: 300_000 },
] as const;

export const DEFAULT_GOOGLE_DRIVE_AUTO_SYNC_INTERVAL_MS = 0;

export type GoogleDrivePreferences = {
  autoSyncIntervalMs: number;
  dismissedConflictSignature: string | null;
  isLocalRestorePending: boolean;
  lastSyncedRemoteSignature: string | null;
  lastUploadedSnapshotSavedAt: string | null;
};

const ALLOWED_AUTO_SYNC_INTERVALS = new Set<number>(
  GOOGLE_DRIVE_AUTO_SYNC_INTERVAL_OPTIONS.map((option) => option.value),
);

const DEFAULT_GOOGLE_DRIVE_PREFERENCES: GoogleDrivePreferences = {
  autoSyncIntervalMs: DEFAULT_GOOGLE_DRIVE_AUTO_SYNC_INTERVAL_MS,
  dismissedConflictSignature: null,
  isLocalRestorePending: false,
  lastSyncedRemoteSignature: null,
  lastUploadedSnapshotSavedAt: null,
};

const normalizeOptionalString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const normalizeAutoSyncIntervalMs = (value: unknown): number =>
  typeof value === 'number' && ALLOWED_AUTO_SYNC_INTERVALS.has(value)
    ? value
    : DEFAULT_GOOGLE_DRIVE_AUTO_SYNC_INTERVAL_MS;

const normalizeBoolean = (value: unknown): boolean => value === true;

export const loadGoogleDrivePreferences = (): GoogleDrivePreferences => {
  if (typeof window === 'undefined') {
    return DEFAULT_GOOGLE_DRIVE_PREFERENCES;
  }

  try {
    const rawValue = window.localStorage.getItem(
      GOOGLE_DRIVE_PREFERENCES_STORAGE_KEY,
    );

    if (!rawValue) {
      return DEFAULT_GOOGLE_DRIVE_PREFERENCES;
    }

    const parsedValue = JSON.parse(rawValue) as Partial<GoogleDrivePreferences>;

    return {
      autoSyncIntervalMs: normalizeAutoSyncIntervalMs(
        parsedValue.autoSyncIntervalMs,
      ),
      dismissedConflictSignature: normalizeOptionalString(
        parsedValue.dismissedConflictSignature,
      ),
      isLocalRestorePending: normalizeBoolean(parsedValue.isLocalRestorePending),
      lastSyncedRemoteSignature: normalizeOptionalString(
        parsedValue.lastSyncedRemoteSignature,
      ),
      lastUploadedSnapshotSavedAt: normalizeOptionalString(
        parsedValue.lastUploadedSnapshotSavedAt,
      ),
    };
  } catch {
    return DEFAULT_GOOGLE_DRIVE_PREFERENCES;
  }
};

export const saveGoogleDrivePreferences = (
  preferences: GoogleDrivePreferences,
): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      GOOGLE_DRIVE_PREFERENCES_STORAGE_KEY,
      JSON.stringify(preferences),
    );
  } catch {
    // Ignore localStorage failures and keep the current in-memory settings.
  }
};
