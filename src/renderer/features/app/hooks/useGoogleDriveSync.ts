import { useEffect, useMemo, useRef, useState } from 'react';
import type { GoogleDriveSyncStatus } from '../../../../shared/sync/googleDriveSync';
import type { WorkspaceSnapshot } from '../../../../shared/sync/workspaceSnapshot';
import { normalizeWorkspaceSnapshot } from '../../conversations/lib/workspaceSnapshot';
import { extractFirstHttpUrl, sanitizeGoogleDriveErrorMessage, type SyncConflictState } from '../lib/appTypes';
import { useGoogleDriveConfigState } from './useGoogleDriveConfigState';
import { useGoogleDrivePreferencesState } from './useGoogleDrivePreferencesState';

type UseGoogleDriveSyncArgs = {
  getLatestWorkspaceSnapshot: () => WorkspaceSnapshot;
  latestWorkspaceSnapshotSavedAt: string;
  restoreWorkspaceSnapshot: (snapshot: WorkspaceSnapshot) => void;
};

export function useGoogleDriveSync({
  getLatestWorkspaceSnapshot,
  latestWorkspaceSnapshotSavedAt,
  restoreWorkspaceSnapshot,
}: UseGoogleDriveSyncArgs) {
  const autoSyncTimeoutRef = useRef<number | null>(null);
  const reconciledRemoteSignatureRef = useRef<string | null>(null);
  const [googleDriveSyncStatus, setGoogleDriveSyncStatus] = useState<GoogleDriveSyncStatus | null>(null);
  const [googleDriveError, setGoogleDriveError] = useState('');
  const [isGoogleDriveBusy, setIsGoogleDriveBusy] = useState(false);
  const [isGoogleDriveAutoSyncing, setIsGoogleDriveAutoSyncing] = useState(false);
  const [syncConflictState, setSyncConflictState] = useState<SyncConflictState | null>(null);

  const { closeGoogleDriveConfigModal, googleDriveConfig, googleDriveConfigError, googleDriveConfigForm, handleGoogleDriveConfigSave, isGoogleDriveConfigModalOpen, isSavingGoogleDriveConfig, openGoogleDriveConfigModal, setGoogleDriveConfig, setGoogleDriveConfigForm } =
    useGoogleDriveConfigState({ onSyncStatusChange: setGoogleDriveSyncStatus });
  const { dismissedConflictSignatureRef, googleDriveAutoSyncIntervalLabel, googleDriveAutoSyncIntervalMs, handleGoogleDriveAutoSyncIntervalChange, isLocalRestorePending, isRemoteSnapshotAlreadySynced, lastUploadedSnapshotSavedAtRef, updateDismissedConflictSignature, updateLastSyncedRemoteSignature, updateLastUploadedSnapshotSavedAt, updateLocalRestorePending } =
    useGoogleDrivePreferencesState();

  const googleDriveErrorLink = useMemo(() => (googleDriveError ? extractFirstHttpUrl(googleDriveError) : null), [googleDriveError]);
  const googleDriveErrorMessage = useMemo(() => (googleDriveError ? sanitizeGoogleDriveErrorMessage(googleDriveError) : ''), [googleDriveError]);
  const buildRemoteSignature = (accountEmail?: string, remoteSavedAt?: string) =>
    remoteSavedAt ? `${accountEmail ?? 'account'}:${remoteSavedAt}` : null;

  useEffect(() => {
    let isCancelled = false;
    const loadState = async () => {
      try {
        const [nextConfig, nextStatus] = await Promise.all([
          window.electronAPI?.getGoogleDriveConfig(),
          window.electronAPI?.getGoogleDriveSyncStatus(),
        ]);
        if (isCancelled) return;
        setGoogleDriveConfig(nextConfig ?? null);
        setGoogleDriveSyncStatus(nextStatus ?? null);
      } catch (error) {
        if (!isCancelled) {
          setGoogleDriveError(error instanceof Error ? error.message : 'Google Drive 상태를 불러오지 못했습니다.');
        }
      }
    };
    void loadState();
    return () => { isCancelled = true; };
  }, [setGoogleDriveConfig]);

  useEffect(() => () => {
    if (autoSyncTimeoutRef.current !== null) window.clearTimeout(autoSyncTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (!googleDriveSyncStatus?.isSignedIn) {
      reconciledRemoteSignatureRef.current = null;
      return setSyncConflictState(null);
    }
    if (!googleDriveSyncStatus.hasRemoteSnapshot || !googleDriveSyncStatus.lastSyncedAt) return setSyncConflictState(null);
    const remoteSignature = buildRemoteSignature(
      googleDriveSyncStatus.accountEmail,
      googleDriveSyncStatus.lastSyncedAt,
    );
    if (!remoteSignature || reconciledRemoteSignatureRef.current === remoteSignature) return;
    reconciledRemoteSignatureRef.current = remoteSignature;

    const localSnapshot = getLatestWorkspaceSnapshot();
    const localSavedAtMs = Date.parse(localSnapshot.savedAt);
    const remoteSavedAtMs = Date.parse(googleDriveSyncStatus.lastSyncedAt);
    if (!Number.isFinite(localSavedAtMs) || !Number.isFinite(remoteSavedAtMs)) return;
    if (dismissedConflictSignatureRef.current === remoteSignature) return setSyncConflictState(null);
    if (isRemoteSnapshotAlreadySynced(localSnapshot.savedAt, remoteSignature)) return setSyncConflictState(null);
    if (Math.abs(remoteSavedAtMs - localSavedAtMs) <= 1000) {
      updateLastUploadedSnapshotSavedAt(localSnapshot.savedAt);
      updateLastSyncedRemoteSignature(remoteSignature);
      updateDismissedConflictSignature(null);
      return setSyncConflictState(null);
    }
    setSyncConflictState(
      remoteSavedAtMs > localSavedAtMs
        ? { localSavedAt: localSnapshot.savedAt, remoteSavedAt: googleDriveSyncStatus.lastSyncedAt, remoteSignature }
        : null,
    );
  }, [dismissedConflictSignatureRef, getLatestWorkspaceSnapshot, googleDriveSyncStatus?.accountEmail, googleDriveSyncStatus?.hasRemoteSnapshot, googleDriveSyncStatus?.isSignedIn, googleDriveSyncStatus?.lastSyncedAt, isRemoteSnapshotAlreadySynced, updateDismissedConflictSignature, updateLastSyncedRemoteSignature, updateLastUploadedSnapshotSavedAt]);

  useEffect(() => {
    if (!googleDriveSyncStatus?.isSignedIn || syncConflictState || googleDriveAutoSyncIntervalMs <= 0 || isLocalRestorePending) return;
    const latestSnapshot = getLatestWorkspaceSnapshot();
    if (lastUploadedSnapshotSavedAtRef.current === latestSnapshot.savedAt) return;
    if (autoSyncTimeoutRef.current !== null) window.clearTimeout(autoSyncTimeoutRef.current);
    autoSyncTimeoutRef.current = window.setTimeout(async () => {
      autoSyncTimeoutRef.current = null;
      setGoogleDriveError('');
      setIsGoogleDriveAutoSyncing(true);
      try {
        const nextStatus = await window.electronAPI?.syncGoogleDriveNow(latestSnapshot);
        updateLastUploadedSnapshotSavedAt(latestSnapshot.savedAt);
        updateLastSyncedRemoteSignature(buildRemoteSignature(nextStatus?.accountEmail, nextStatus?.lastSyncedAt));
        updateDismissedConflictSignature(null);
        setGoogleDriveSyncStatus(nextStatus ?? null);
      } catch (error) {
        setGoogleDriveError(error instanceof Error ? error.message : 'Google Drive 자동 동기화에 실패했습니다.');
      } finally {
        setIsGoogleDriveAutoSyncing(false);
      }
    }, googleDriveAutoSyncIntervalMs);
    return () => {
      if (autoSyncTimeoutRef.current !== null) {
        window.clearTimeout(autoSyncTimeoutRef.current);
        autoSyncTimeoutRef.current = null;
      }
    };
  }, [getLatestWorkspaceSnapshot, googleDriveAutoSyncIntervalMs, googleDriveSyncStatus?.isSignedIn, isLocalRestorePending, lastUploadedSnapshotSavedAtRef, latestWorkspaceSnapshotSavedAt, syncConflictState, updateDismissedConflictSignature, updateLastSyncedRemoteSignature, updateLastUploadedSnapshotSavedAt]);

  const downloadDriveSnapshot = async () => {
    const snapshot = normalizeWorkspaceSnapshot(await window.electronAPI?.downloadGoogleDriveSnapshot());
    if (!snapshot) throw new Error('Google Drive에 복원할 작업 공간이 없습니다.');
    updateLastUploadedSnapshotSavedAt(snapshot.savedAt);
    restoreWorkspaceSnapshot(snapshot);
    const nextStatus = await window.electronAPI?.getGoogleDriveSyncStatus();
    updateLastSyncedRemoteSignature(buildRemoteSignature(nextStatus?.accountEmail, nextStatus?.lastSyncedAt));
    updateDismissedConflictSignature(null);
    updateLocalRestorePending(false);
    setSyncConflictState(null);
    setGoogleDriveSyncStatus(nextStatus ?? null);
  };

  const reconcileGoogleDriveConnection = async (nextStatus: GoogleDriveSyncStatus) => {
    setGoogleDriveSyncStatus(nextStatus);
    if (!nextStatus.isSignedIn) return;
    if (isLocalRestorePending) return setSyncConflictState(null);
    const localSnapshot = getLatestWorkspaceSnapshot();
    const localSavedAtMs = Date.parse(localSnapshot.savedAt);
    const remoteSavedAtMs = nextStatus.lastSyncedAt ? Date.parse(nextStatus.lastSyncedAt) : Number.NaN;
    const remoteSignature = buildRemoteSignature(nextStatus.accountEmail, nextStatus.lastSyncedAt);
    if (remoteSignature && dismissedConflictSignatureRef.current === remoteSignature) return setSyncConflictState(null);
    if (isRemoteSnapshotAlreadySynced(localSnapshot.savedAt, remoteSignature)) return setSyncConflictState(null);

    if (nextStatus.hasRemoteSnapshot && Number.isFinite(localSavedAtMs) && Number.isFinite(remoteSavedAtMs) && remoteSavedAtMs > localSavedAtMs + 1000) {
      return setSyncConflictState({
        localSavedAt: localSnapshot.savedAt,
        remoteSavedAt: nextStatus.lastSyncedAt ?? new Date().toISOString(),
        remoteSignature: remoteSignature ?? 'remote',
      });
    }
    if (nextStatus.hasRemoteSnapshot && Number.isFinite(localSavedAtMs) && Number.isFinite(remoteSavedAtMs) && Math.abs(remoteSavedAtMs - localSavedAtMs) <= 1000) {
      updateLastUploadedSnapshotSavedAt(localSnapshot.savedAt);
      updateLastSyncedRemoteSignature(remoteSignature);
      updateDismissedConflictSignature(null);
      return setSyncConflictState(null);
    }
    const uploadedStatus = await window.electronAPI?.syncGoogleDriveNow(localSnapshot);
    updateLastUploadedSnapshotSavedAt(localSnapshot.savedAt);
    updateLastSyncedRemoteSignature(buildRemoteSignature(uploadedStatus?.accountEmail, uploadedStatus?.lastSyncedAt));
    updateDismissedConflictSignature(null);
    setSyncConflictState(null);
    setGoogleDriveSyncStatus(uploadedStatus ?? nextStatus);
  };
  return {
    closeGoogleDriveConfigModal,
    googleDriveAutoSyncIntervalLabel,
    googleDriveAutoSyncIntervalMs,
    googleDriveConfig,
    googleDriveConfigError,
    googleDriveConfigForm,
    googleDriveError,
    googleDriveErrorLink,
    googleDriveErrorMessage,
    googleDriveSyncStatus,
    handleDismissSyncConflict: () => {
      if (syncConflictState?.remoteSignature) updateDismissedConflictSignature(syncConflictState.remoteSignature);
      setSyncConflictState(null);
    },
    handleGoogleDriveAutoSyncIntervalChange,
    handleGoogleDriveConfigSave,
    handleGoogleDriveDisconnect: async () => {
      setGoogleDriveError('');
      setIsGoogleDriveBusy(true);
      try {
        const nextStatus = await window.electronAPI?.disconnectGoogleDrive();
        updateDismissedConflictSignature(null);
        updateLastSyncedRemoteSignature(null);
        updateLastUploadedSnapshotSavedAt(null);
        updateLocalRestorePending(false);
        setSyncConflictState(null);
        setGoogleDriveSyncStatus(nextStatus ?? null);
      } catch (error) {
        setGoogleDriveError(error instanceof Error ? error.message : 'Google Drive 연동 해제에 실패했습니다.');
      } finally {
        setIsGoogleDriveBusy(false);
      }
    },
    handleGoogleDriveRestore: async () => {
      setGoogleDriveError('');
      setIsGoogleDriveBusy(true);
      try {
        await downloadDriveSnapshot();
      } catch (error) {
        setGoogleDriveError(error instanceof Error ? error.message : 'Google Drive에서 작업 공간을 불러오지 못했습니다.');
      } finally {
        setIsGoogleDriveBusy(false);
      }
    },
    handleGoogleDriveSignIn: async () => {
      setGoogleDriveError('');
      setIsGoogleDriveBusy(true);
      try {
        const nextStatus = await window.electronAPI?.signInGoogleDrive();
        if (nextStatus) await reconcileGoogleDriveConnection(nextStatus);
        else setGoogleDriveSyncStatus(null);
      } catch (error) {
        setGoogleDriveError(error instanceof Error ? error.message : 'Google Drive 로그인에 실패했습니다.');
      } finally {
        setIsGoogleDriveBusy(false);
      }
    },
    handleGoogleDriveSignOut: async () => {
      setGoogleDriveError('');
      setIsGoogleDriveBusy(true);
      try {
        const nextStatus = await window.electronAPI?.signOutGoogleDrive();
        updateDismissedConflictSignature(null);
        updateLastSyncedRemoteSignature(null);
        setSyncConflictState(null);
        setGoogleDriveSyncStatus(nextStatus ?? null);
      } catch (error) {
        setGoogleDriveError(error instanceof Error ? error.message : 'Google Drive 로그아웃에 실패했습니다.');
      } finally {
        setIsGoogleDriveBusy(false);
      }
    },
    handleGoogleDriveSyncNow: async () => {
      setGoogleDriveError('');
      setIsGoogleDriveBusy(true);
      try {
        if (isLocalRestorePending) return await downloadDriveSnapshot();
        const snapshot = getLatestWorkspaceSnapshot();
        const nextStatus = await window.electronAPI?.syncGoogleDriveNow(snapshot);
        updateLastUploadedSnapshotSavedAt(snapshot.savedAt);
        updateLastSyncedRemoteSignature(buildRemoteSignature(nextStatus?.accountEmail, nextStatus?.lastSyncedAt));
        updateDismissedConflictSignature(null);
        updateLocalRestorePending(false);
        setSyncConflictState(null);
        setGoogleDriveSyncStatus(nextStatus ?? null);
      } catch (error) {
        setGoogleDriveError(error instanceof Error ? error.message : 'Google Drive 저장에 실패했습니다.');
      } finally {
        setIsGoogleDriveBusy(false);
      }
    },
    handleKeepLocalSnapshot: async () => {
      setSyncConflictState(null);
      setGoogleDriveError('');
      setIsGoogleDriveBusy(true);
      try {
        const snapshot = getLatestWorkspaceSnapshot();
        const nextStatus = await window.electronAPI?.syncGoogleDriveNow(snapshot);
        updateLastUploadedSnapshotSavedAt(snapshot.savedAt);
        updateLastSyncedRemoteSignature(buildRemoteSignature(nextStatus?.accountEmail, nextStatus?.lastSyncedAt));
        updateDismissedConflictSignature(null);
        updateLocalRestorePending(false);
        setGoogleDriveSyncStatus(nextStatus ?? null);
      } catch (error) {
        setGoogleDriveError(error instanceof Error ? error.message : 'Google Drive 저장에 실패했습니다.');
      } finally {
        setIsGoogleDriveBusy(false);
      }
    },
    isGoogleDriveAutoSyncing,
    isGoogleDriveBusy,
    isGoogleDriveConfigModalOpen,
    isLocalRestorePending,
    isSavingGoogleDriveConfig,
    markLocalWorkspaceCleared: () => {
      setSyncConflictState(null);
      updateDismissedConflictSignature(null);
      updateLastUploadedSnapshotSavedAt(null);
      updateLocalRestorePending(true);
    },
    openGoogleDriveConfigModal,
    setGoogleDriveConfigForm,
    syncConflictState,
  };
}
