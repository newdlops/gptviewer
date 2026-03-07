import type { ChangeEvent, FormEvent } from 'react';
import { Button } from '../../../../components/ui/Button';
import { Modal } from '../../../../components/ui/Modal';
import type { GoogleDriveConfigFormState, SyncConflictState } from '../../lib/appTypes';
import { GOOGLE_DRIVE_AUTO_SYNC_INTERVAL_OPTIONS } from '../../../sync/lib/googleDrivePreferences';
import type { GoogleDriveSyncStatus } from '../../../../../shared/sync/googleDriveSync';

type GoogleDriveModalsProps = {
  googleDriveAutoSyncIntervalLabel: string;
  googleDriveAutoSyncIntervalMs: number;
  googleDriveConfigError: string;
  googleDriveConfigForm: GoogleDriveConfigFormState | null;
  googleDriveErrorLink: string | null;
  googleDriveErrorMessage: string;
  googleDriveSyncStatus: GoogleDriveSyncStatus | null;
  isGoogleDriveAutoSyncing: boolean;
  isGoogleDriveBusy: boolean;
  isGoogleDriveConfigModalOpen: boolean;
  isLocalRestorePending: boolean;
  isSavingGoogleDriveConfig: boolean;
  onAutoSyncIntervalChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  onClearLocalWorkspace: () => void;
  onCloseGoogleDriveConfig: () => void;
  onDisconnect: () => void;
  onDismissSyncConflict: () => void;
  onGoogleDriveConfigFormChange: (
    nextState:
      | GoogleDriveConfigFormState
      | null
      | ((current: GoogleDriveConfigFormState | null) => GoogleDriveConfigFormState | null),
  ) => void;
  onGoogleDriveConfigSave: (event: FormEvent<HTMLFormElement>) => void;
  onGoogleDriveRestore: () => void;
  onKeepLocalSnapshot: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onSyncNow: () => void;
  syncConflictState: SyncConflictState | null;
};

export function GoogleDriveModals({
  googleDriveAutoSyncIntervalLabel,
  googleDriveAutoSyncIntervalMs,
  googleDriveConfigError,
  googleDriveConfigForm,
  googleDriveErrorLink,
  googleDriveErrorMessage,
  googleDriveSyncStatus,
  isGoogleDriveAutoSyncing,
  isGoogleDriveBusy,
  isGoogleDriveConfigModalOpen,
  isLocalRestorePending,
  isSavingGoogleDriveConfig,
  onAutoSyncIntervalChange,
  onClearLocalWorkspace,
  onCloseGoogleDriveConfig,
  onDisconnect,
  onDismissSyncConflict,
  onGoogleDriveConfigFormChange,
  onGoogleDriveConfigSave,
  onGoogleDriveRestore,
  onKeepLocalSnapshot,
  onSignIn,
  onSignOut,
  onSyncNow,
  syncConflictState,
}: GoogleDriveModalsProps) {
  const isConfigured = googleDriveSyncStatus?.isConfigured ?? false;
  const isSignedIn = googleDriveSyncStatus?.isSignedIn ?? false;

  return (
    <>
      <Modal ariaLabelledBy="drive-conflict-modal-title" eyebrow="Google Drive 충돌" isOpen={!!syncConflictState} onClose={onDismissSyncConflict} title="원격 작업 공간이 더 최신입니다">
        <div className="modal__form">
          <p className="modal__hint">Google Drive에 저장된 작업 공간이 현재 로컬 작업 공간보다 더 최근에 수정되었습니다. 어느 버전을 유지할지 선택해 주세요.</p>
          <div className="modal__warning">
            <strong>버전 비교</strong>
            <span>로컬 저장 시각: {syncConflictState ? new Date(syncConflictState.localSavedAt).toLocaleString('ko-KR') : '-'}</span>
            <span>Drive 저장 시각: {syncConflictState ? new Date(syncConflictState.remoteSavedAt).toLocaleString('ko-KR') : '-'}</span>
          </div>
          <div className="modal__actions">
            <Button variant="ghost" onClick={onDismissSyncConflict} disabled={isGoogleDriveBusy || isGoogleDriveAutoSyncing}>나중에</Button>
            <Button variant="secondary" onClick={onGoogleDriveRestore} disabled={isGoogleDriveBusy || isGoogleDriveAutoSyncing}>Drive 버전 복원</Button>
            <Button variant="primary" onClick={onKeepLocalSnapshot} disabled={isGoogleDriveBusy || isGoogleDriveAutoSyncing}>로컬 유지 후 업로드</Button>
          </div>
        </div>
      </Modal>

      <Modal ariaLabelledBy="google-drive-config-modal-title" eyebrow="Google Drive 연동 설정" isOpen={isGoogleDriveConfigModalOpen} onClose={onCloseGoogleDriveConfig} title="Google Drive 설정">
        <form className="modal__form" onSubmit={onGoogleDriveConfigSave}>
          <div className="modal__section">
            <div className="modal__section-header">
              <strong>동기화</strong>
              <span>{googleDriveSyncStatus?.accountEmail ?? googleDriveSyncStatus?.message ?? '연결되지 않음'}</span>
            </div>
            {googleDriveSyncStatus?.lastSyncedAt ? (
              <p className="modal__hint">마지막 동기화 {new Date(googleDriveSyncStatus.lastSyncedAt).toLocaleString('ko-KR')}</p>
            ) : null}
            <label className="modal__label" htmlFor="google-drive-auto-sync-interval">
              자동 동기화 주기
              <span className="modal__label-meta">현재 설정: {googleDriveAutoSyncIntervalLabel}</span>
            </label>
            <select
              id="google-drive-auto-sync-interval"
              className="modal__input modal__select"
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
            {isLocalRestorePending ? (
              <p className="modal__hint">로컬 작업 공간을 비웠습니다. 지금 동기화하면 Drive에서 복원합니다.</p>
            ) : null}
            {googleDriveErrorMessage ? (
              <p className="modal__error" role="alert">
                {googleDriveErrorMessage}{' '}
                {googleDriveErrorLink ? (
                  <a href={googleDriveErrorLink} target="_blank" rel="noreferrer">
                    Drive API 켜기
                  </a>
                ) : null}
              </p>
            ) : null}
            <div className="modal__actions modal__actions--stacked">
              <Button variant="ghost" onClick={onSyncNow} disabled={isGoogleDriveBusy || isGoogleDriveAutoSyncing}>
                {isLocalRestorePending ? 'Drive에서 복원' : '지금 동기화'}
              </Button>
              <Button variant="danger" onClick={onClearLocalWorkspace} disabled={isGoogleDriveBusy || isGoogleDriveAutoSyncing}>
                로컬 비우기
              </Button>
            </div>
          </div>

          <div className="modal__section">
            <div className="modal__section-header">
              <strong>계정</strong>
              <span>{isSignedIn ? '연결됨' : isConfigured ? '로그인 필요' : '설정 필요'}</span>
            </div>
            <div className="modal__actions modal__actions--stacked">
              {isSignedIn ? (
                <>
                  <Button variant="secondary" onClick={onSignOut} disabled={isGoogleDriveBusy || isGoogleDriveAutoSyncing}>
                    로그아웃
                  </Button>
                  <Button variant="danger" onClick={onDisconnect} disabled={isGoogleDriveBusy || isGoogleDriveAutoSyncing}>
                    연동 해제
                  </Button>
                </>
              ) : (
                <Button variant="secondary" onClick={onSignIn} disabled={isGoogleDriveBusy || isGoogleDriveAutoSyncing || !isConfigured}>
                  {isConfigured ? 'Google Drive 로그인' : 'OAuth 설정 저장 후 로그인'}
                </Button>
              )}
            </div>
          </div>

          <div className="modal__section">
            <div className="modal__section-header">
              <strong>OAuth</strong>
              <span>
                {googleDriveConfigForm?.source === 'app'
                  ? '앱 저장값'
                  : googleDriveConfigForm?.source === 'env'
                    ? '환경 변수'
                    : googleDriveConfigForm?.source === 'file'
                      ? '외부 credentials 파일'
                      : '없음'}
              </span>
            </div>
          <label className="modal__label" htmlFor="google-drive-client-id">클라이언트 ID</label>
          <input
            id="google-drive-client-id"
            className="modal__input"
            type="text"
            placeholder="Google OAuth 클라이언트 ID"
            value={googleDriveConfigForm?.clientId ?? ''}
            onChange={(event) => onGoogleDriveConfigFormChange((current) => (current ? { ...current, clientId: event.target.value } : current))}
            autoFocus
            disabled={isSavingGoogleDriveConfig}
          />
          <label className="modal__label" htmlFor="google-drive-client-secret">클라이언트 시크릿</label>
          <input
            id="google-drive-client-secret"
            className="modal__input"
            type="password"
            placeholder={googleDriveConfigForm?.hasExistingClientSecret ? '비워두면 기존 시크릿 유지' : '선택 입력'}
            value={googleDriveConfigForm?.clientSecret ?? ''}
            onChange={(event) => onGoogleDriveConfigFormChange((current) => (current ? { ...current, clientSecret: event.target.value } : current))}
            disabled={isSavingGoogleDriveConfig}
          />
          <p className="modal__hint">앱 안에서 Google OAuth 데스크톱 클라이언트 정보를 저장할 수 있습니다.</p>
          {googleDriveConfigForm?.source === 'none' ? (
            <p className="modal__hint">
              아직 앱에 OAuth 설정이 없습니다. 먼저 Google Cloud Console에서 Desktop app OAuth 클라이언트를 만든 뒤, 발급된 클라이언트 ID를 여기에 넣어야 합니다.{' '}
              <a href={googleDriveConfigForm.setupUrl} target="_blank" rel="noreferrer">설정 페이지 열기</a>
            </p>
          ) : null}
          </div>
          {googleDriveConfigError ? <p className="modal__error" role="alert">{googleDriveConfigError}</p> : null}
          <div className="modal__actions">
            <Button variant="secondary" onClick={onCloseGoogleDriveConfig} disabled={isSavingGoogleDriveConfig}>취소</Button>
            <Button variant="primary" type="submit" disabled={isSavingGoogleDriveConfig}>
              {isSavingGoogleDriveConfig ? '저장 중...' : '설정 저장'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
