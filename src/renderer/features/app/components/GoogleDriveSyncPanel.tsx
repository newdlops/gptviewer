import type { ChangeEvent } from 'react';
import { Button } from '../../../components/ui/Button';
import { GOOGLE_DRIVE_AUTO_SYNC_INTERVAL_OPTIONS } from '../../sync/lib/googleDrivePreferences';
import type { GoogleDriveSyncStatus } from '../../../../shared/sync/googleDriveSync';

type GoogleDriveSyncPanelProps = {
  googleDriveAutoSyncIntervalLabel: string;
  googleDriveAutoSyncIntervalMs: number;
  googleDriveErrorLink: string | null;
  googleDriveErrorMessage: string;
  googleDriveSyncStatus: GoogleDriveSyncStatus | null;
  isGoogleDriveAutoSyncing: boolean;
  isGoogleDriveBusy: boolean;
  isLocalRestorePending: boolean;
  onAutoSyncIntervalChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  onClearLocalWorkspace: () => void;
  onOpenGoogleDriveConfig: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onDisconnect: () => void;
  onSyncNow: () => void;
};

export function GoogleDriveSyncPanel({
  googleDriveAutoSyncIntervalLabel,
  googleDriveAutoSyncIntervalMs,
  googleDriveErrorLink,
  googleDriveErrorMessage,
  googleDriveSyncStatus,
  isGoogleDriveAutoSyncing,
  isGoogleDriveBusy,
  isLocalRestorePending,
  onAutoSyncIntervalChange,
  onClearLocalWorkspace,
  onOpenGoogleDriveConfig,
  onSignIn,
  onSignOut,
  onDisconnect,
  onSyncNow,
}: GoogleDriveSyncPanelProps) {
  const isConfigured = googleDriveSyncStatus?.isConfigured ?? false;
  const isSignedIn = googleDriveSyncStatus?.isSignedIn ?? false;

  return (
    <div className="drawer-sync">
      <div className="drawer-sync__status">
        <strong>Google Drive</strong>
        <span>
          {isGoogleDriveAutoSyncing
            ? '변경 사항을 자동 동기화하는 중입니다...'
            : googleDriveSyncStatus?.accountEmail
              ? googleDriveSyncStatus.accountEmail
              : googleDriveSyncStatus?.message ?? '연결 상태를 확인하는 중...'}
        </span>
        {googleDriveSyncStatus?.lastSyncedAt ? (
          <small>마지막 동기화 {new Date(googleDriveSyncStatus.lastSyncedAt).toLocaleString('ko-KR')}</small>
        ) : null}
        <small>자동 동기화 주기: {googleDriveAutoSyncIntervalLabel}</small>
        {isLocalRestorePending ? (
          <small>로컬 작업 공간을 비웠습니다. 지금 동기화하면 Drive에서 복원합니다.</small>
        ) : null}
        {googleDriveErrorMessage ? (
          <small className="drawer-sync__error">
            <span>{googleDriveErrorMessage}</span>
            {googleDriveErrorLink ? (
              <a className="drawer-sync__error-link" href={googleDriveErrorLink} target="_blank" rel="noreferrer">
                Drive API 켜기
              </a>
            ) : null}
          </small>
        ) : null}
      </div>

      <div className="drawer-sync__settings">
        <label htmlFor="google-drive-auto-sync-interval">자동 동기화 주기</label>
        <select
          id="google-drive-auto-sync-interval"
          className="drawer-sync__select"
          value={googleDriveAutoSyncIntervalMs}
          onChange={onAutoSyncIntervalChange}
          disabled={isGoogleDriveBusy || isGoogleDriveAutoSyncing}
        >
          {GOOGLE_DRIVE_AUTO_SYNC_INTERVAL_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="drawer-sync__actions">
        {isSignedIn ? (
          <>
            <Button variant="ghost" onClick={onSyncNow} disabled={isGoogleDriveBusy || isGoogleDriveAutoSyncing}>
              <span className="drawer-button__icon" aria-hidden="true">{isLocalRestorePending ? '↓' : '↻'}</span>
              <span className="drawer-button__label">{isLocalRestorePending ? 'Drive에서 복원' : '지금 동기화'}</span>
            </Button>
            <Button variant="danger" onClick={onClearLocalWorkspace} disabled={isGoogleDriveBusy || isGoogleDriveAutoSyncing}>
              <span className="drawer-button__icon" aria-hidden="true">⌫</span>
              <span className="drawer-button__label">로컬 비우기</span>
            </Button>
            <Button variant="ghost" onClick={onOpenGoogleDriveConfig} disabled={isGoogleDriveBusy || isGoogleDriveAutoSyncing}>
              <span className="drawer-button__icon" aria-hidden="true">⚙</span>
              <span className="drawer-button__label">연동 설정</span>
            </Button>
            <Button variant="secondary" onClick={onSignOut} disabled={isGoogleDriveBusy || isGoogleDriveAutoSyncing}>
              <span className="drawer-button__icon" aria-hidden="true">⨯</span>
              <span className="drawer-button__label">로그아웃</span>
            </Button>
            <Button variant="danger" onClick={onDisconnect} disabled={isGoogleDriveBusy || isGoogleDriveAutoSyncing}>
              <span className="drawer-button__icon" aria-hidden="true">⛓</span>
              <span className="drawer-button__label">연동 해제</span>
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              onClick={isConfigured ? onSignIn : onOpenGoogleDriveConfig}
              disabled={isGoogleDriveBusy || isGoogleDriveAutoSyncing}
            >
              <span className="drawer-button__icon" aria-hidden="true">{isConfigured ? '☁' : '↗'}</span>
              <span className="drawer-button__label">
                {isConfigured ? (isGoogleDriveBusy ? '로그인 중...' : 'Google Drive 로그인') : '연동 설정 시작'}
              </span>
            </Button>
            <Button variant="danger" onClick={onClearLocalWorkspace} disabled={isGoogleDriveBusy || isGoogleDriveAutoSyncing}>
              <span className="drawer-button__icon" aria-hidden="true">⌫</span>
              <span className="drawer-button__label">로컬 비우기</span>
            </Button>
            {isConfigured ? (
              <Button variant="secondary" onClick={onOpenGoogleDriveConfig} disabled={isGoogleDriveBusy || isGoogleDriveAutoSyncing}>
                <span className="drawer-button__icon" aria-hidden="true">⚙</span>
                <span className="drawer-button__label">연동 설정</span>
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
