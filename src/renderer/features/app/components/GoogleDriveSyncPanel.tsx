import { Button } from '../../../components/ui/Button';
import type { GoogleDriveSyncStatus } from '../../../../shared/sync/googleDriveSync';

type GoogleDriveSyncPanelProps = {
  googleDriveErrorLink: string | null;
  googleDriveErrorMessage: string;
  googleDriveSyncStatus: GoogleDriveSyncStatus | null;
  isGoogleDriveAutoSyncing: boolean;
  isGoogleDriveBusy: boolean;
  isLocalRestorePending: boolean;
  onOpenGoogleDriveConfig: () => void;
  onRestore: () => void;
  onSignIn: () => void;
  onSyncNow: () => void;
};

export function GoogleDriveSyncPanel({
  googleDriveErrorLink,
  googleDriveErrorMessage,
  googleDriveSyncStatus,
  isGoogleDriveAutoSyncing,
  isGoogleDriveBusy,
  isLocalRestorePending,
  onOpenGoogleDriveConfig,
  onRestore,
  onSignIn,
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
          <small>마지막 저장 {new Date(googleDriveSyncStatus.lastSyncedAt).toLocaleString('ko-KR')}</small>
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

      <div className="drawer-sync__actions">
        {isSignedIn ? (
          <>
            <div className="drawer-sync__action-group">
              <Button 
                variant="ghost" 
                onClick={onSyncNow} 
                disabled={isGoogleDriveBusy || isGoogleDriveAutoSyncing}
                title="현재 로컬 데이터를 Google Drive에 저장합니다 (덮어쓰기)"
              >
                <span className="drawer-button__icon" aria-hidden="true">↑</span>
                <span className="drawer-button__label">저장하기</span>
              </Button>
              <Button 
                variant="ghost" 
                onClick={() => {
                  if (window.confirm('Google Drive에서 데이터를 불러오시겠습니까? 현재 로컬 작업 공간의 데이터가 교체됩니다.')) {
                    onRestore();
                  }
                }} 
                disabled={isGoogleDriveBusy || isGoogleDriveAutoSyncing || !googleDriveSyncStatus?.hasRemoteSnapshot}
                title="Google Drive에서 마지막 저장된 데이터를 불러옵니다 (로컬 덮어쓰기)"
              >
                <span className="drawer-button__icon" aria-hidden="true">↓</span>
                <span className="drawer-button__label">불러오기</span>
              </Button>
            </div>
            <Button variant="ghost" onClick={onOpenGoogleDriveConfig} disabled={isGoogleDriveBusy || isGoogleDriveAutoSyncing}>
              <span className="drawer-button__icon" aria-hidden="true">⚙</span>
              <span className="drawer-button__label">설정</span>
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
            {isConfigured ? (
              <Button variant="secondary" onClick={onOpenGoogleDriveConfig} disabled={isGoogleDriveBusy || isGoogleDriveAutoSyncing}>
                <span className="drawer-button__icon" aria-hidden="true">⚙</span>
                <span className="drawer-button__label">설정</span>
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
