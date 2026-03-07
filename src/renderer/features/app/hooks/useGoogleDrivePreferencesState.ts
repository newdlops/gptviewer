import { type ChangeEvent, useCallback, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_GOOGLE_DRIVE_AUTO_SYNC_INTERVAL_MS,
  GOOGLE_DRIVE_AUTO_SYNC_INTERVAL_OPTIONS,
  loadGoogleDrivePreferences,
  saveGoogleDrivePreferences,
  type GoogleDrivePreferences,
} from '../../sync/lib/googleDrivePreferences';

export function useGoogleDrivePreferencesState() {
  const initialPreferencesRef = useRef(loadGoogleDrivePreferences());
  const lastUploadedSnapshotSavedAtRef = useRef<string | null>(initialPreferencesRef.current.lastUploadedSnapshotSavedAt);
  const lastSyncedRemoteSignatureRef = useRef<string | null>(initialPreferencesRef.current.lastSyncedRemoteSignature);
  const dismissedConflictSignatureRef = useRef<string | null>(initialPreferencesRef.current.dismissedConflictSignature);
  const [googleDriveAutoSyncIntervalMs, setGoogleDriveAutoSyncIntervalMs] = useState(initialPreferencesRef.current.autoSyncIntervalMs);
  const [isLocalRestorePending, setIsLocalRestorePending] = useState(initialPreferencesRef.current.isLocalRestorePending);

  const googleDriveAutoSyncIntervalLabel = useMemo(
    () =>
      GOOGLE_DRIVE_AUTO_SYNC_INTERVAL_OPTIONS.find((option) => option.value === googleDriveAutoSyncIntervalMs)?.label ?? '30초',
    [googleDriveAutoSyncIntervalMs],
  );

  const persistPreferences = useCallback((overrides: Partial<GoogleDrivePreferences> = {}) => {
    saveGoogleDrivePreferences({
      autoSyncIntervalMs: overrides.autoSyncIntervalMs ?? googleDriveAutoSyncIntervalMs,
      dismissedConflictSignature:
        overrides.dismissedConflictSignature !== undefined
          ? overrides.dismissedConflictSignature
          : dismissedConflictSignatureRef.current,
      isLocalRestorePending:
        overrides.isLocalRestorePending !== undefined ? overrides.isLocalRestorePending : isLocalRestorePending,
      lastSyncedRemoteSignature:
        overrides.lastSyncedRemoteSignature !== undefined
          ? overrides.lastSyncedRemoteSignature
          : lastSyncedRemoteSignatureRef.current,
      lastUploadedSnapshotSavedAt:
        overrides.lastUploadedSnapshotSavedAt !== undefined
          ? overrides.lastUploadedSnapshotSavedAt
          : lastUploadedSnapshotSavedAtRef.current,
    });
  }, [googleDriveAutoSyncIntervalMs, isLocalRestorePending]);

  const updateDismissedConflictSignature = useCallback((value: string | null) => {
    dismissedConflictSignatureRef.current = value;
    persistPreferences({ dismissedConflictSignature: value });
  }, [persistPreferences]);
  const updateLastSyncedRemoteSignature = useCallback((value: string | null) => {
    lastSyncedRemoteSignatureRef.current = value;
    persistPreferences({ lastSyncedRemoteSignature: value });
  }, [persistPreferences]);
  const updateLastUploadedSnapshotSavedAt = useCallback((value: string | null) => {
    lastUploadedSnapshotSavedAtRef.current = value;
    persistPreferences({ lastUploadedSnapshotSavedAt: value });
  }, [persistPreferences]);
  const updateLocalRestorePending = useCallback((value: boolean) => {
    setIsLocalRestorePending(value);
    persistPreferences({ isLocalRestorePending: value });
  }, [persistPreferences]);
  const isRemoteSnapshotAlreadySynced = useCallback((localSavedAt: string, remoteSignature: string | null) =>
    !!remoteSignature &&
    lastUploadedSnapshotSavedAtRef.current === localSavedAt &&
    lastSyncedRemoteSignatureRef.current === remoteSignature,
  []);

  const handleGoogleDriveAutoSyncIntervalChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const nextIntervalMs = Number.parseInt(event.target.value, 10);
    const normalized = Number.isFinite(nextIntervalMs) ? nextIntervalMs : DEFAULT_GOOGLE_DRIVE_AUTO_SYNC_INTERVAL_MS;
    setGoogleDriveAutoSyncIntervalMs(normalized);
    persistPreferences({ autoSyncIntervalMs: normalized });
  }, [persistPreferences]);

  return {
    dismissedConflictSignatureRef,
    googleDriveAutoSyncIntervalLabel,
    googleDriveAutoSyncIntervalMs,
    handleGoogleDriveAutoSyncIntervalChange,
    isLocalRestorePending,
    isRemoteSnapshotAlreadySynced,
    lastSyncedRemoteSignatureRef,
    lastUploadedSnapshotSavedAtRef,
    persistPreferences,
    updateDismissedConflictSignature,
    updateLastSyncedRemoteSignature,
    updateLastUploadedSnapshotSavedAt,
    updateLocalRestorePending,
  };
}
