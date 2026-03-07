import type { FormEvent } from 'react';
import { Button } from '../../../../components/ui/Button';
import { Modal } from '../../../../components/ui/Modal';
import type { GoogleDriveConfigFormState, SyncConflictState } from '../../lib/appTypes';

type GoogleDriveModalsProps = {
  googleDriveConfigError: string;
  googleDriveConfigForm: GoogleDriveConfigFormState | null;
  isGoogleDriveAutoSyncing: boolean;
  isGoogleDriveBusy: boolean;
  isGoogleDriveConfigModalOpen: boolean;
  isSavingGoogleDriveConfig: boolean;
  onCloseGoogleDriveConfig: () => void;
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
  syncConflictState: SyncConflictState | null;
};

export function GoogleDriveModals({
  googleDriveConfigError,
  googleDriveConfigForm,
  isGoogleDriveAutoSyncing,
  isGoogleDriveBusy,
  isGoogleDriveConfigModalOpen,
  isSavingGoogleDriveConfig,
  onCloseGoogleDriveConfig,
  onDismissSyncConflict,
  onGoogleDriveConfigFormChange,
  onGoogleDriveConfigSave,
  onGoogleDriveRestore,
  onKeepLocalSnapshot,
  syncConflictState,
}: GoogleDriveModalsProps) {
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

      <Modal ariaLabelledBy="google-drive-config-modal-title" eyebrow="Google Drive 연동 설정" isOpen={isGoogleDriveConfigModalOpen} onClose={onCloseGoogleDriveConfig} title="Google OAuth 설정">
        <form className="modal__form" onSubmit={onGoogleDriveConfigSave}>
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
          <p className="modal__hint">
            앱 안에서 Google OAuth 데스크톱 클라이언트 정보를 저장할 수 있습니다. 현재 설정 출처:{' '}
            <strong>
              {googleDriveConfigForm?.source === 'app'
                ? '앱 저장값'
                : googleDriveConfigForm?.source === 'env'
                  ? '환경 변수'
                  : googleDriveConfigForm?.source === 'file'
                    ? '외부 credentials 파일'
                    : '없음'}
            </strong>
          </p>
          {googleDriveConfigForm?.source === 'none' ? (
            <p className="modal__hint">
              아직 앱에 OAuth 설정이 없습니다. 먼저 Google Cloud Console에서 Desktop app OAuth 클라이언트를 만든 뒤, 발급된 클라이언트 ID를 여기에 넣어야 합니다.{' '}
              <a href={googleDriveConfigForm.setupUrl} target="_blank" rel="noreferrer">설정 페이지 열기</a>
            </p>
          ) : null}
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
