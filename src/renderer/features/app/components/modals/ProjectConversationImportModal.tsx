import type { FormEvent } from 'react';
import { Button } from '../../../../components/ui/Button';
import { Modal } from '../../../../components/ui/Modal';
import {
  formatFolderOptionLabel,
  getFolderSelectValue,
  parseFolderSelectValue,
} from '../../lib/appTypes';
import {
  PROJECT_CONVERSATION_IMPORT_STRATEGY_OPTIONS,
  type ProjectConversationImportStrategyPreference,
} from '../../lib/projectConversationImportPreferences';
import type {
  ProjectConversationImportFailure,
  ProjectConversationImportMode,
  ProjectConversationImportProgress,
  ProjectConversationSyncSummary,
} from '../../../../../shared/import/projectConversationImport';

type ProjectConversationImportModalProps = {
  allFolderOptions: Array<{ depth: number; id: string; name: string }>;
  canRetryAllFailures: boolean;
  importError: string;
  failures: ProjectConversationImportFailure[];
  isBusy: boolean;
  isImporting: boolean;
  isOpen: boolean;
  mode: ProjectConversationImportMode;
  onClose: () => void;
  onParentFolderChange: (folderId: string | null) => void;
  onPreferredStrategyChange: (
    strategy: ProjectConversationImportStrategyPreference,
  ) => void;
  onProjectUrlChange: (value: string) => void;
  onRetryAllFailures: () => void;
  onRetryFailure: (chatUrl: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onWorkerCountChange: (workerCount: number) => void;
  parentFolderId: string | null;
  preferredStrategy: ProjectConversationImportStrategyPreference;
  progress: ProjectConversationImportProgress | null;
  projectUrl: string;
  syncSummary: ProjectConversationSyncSummary | null;
  workerCount: number;
};

const getProgressLabel = (progress: ProjectConversationImportProgress | null) => {
  if (!progress) {
    return '';
  }
  if (progress.phase === 'collecting') {
    return `대화 목록 수집 중... 링크 ${progress.collectedCount}개, 현재 DOM ${progress.listItemCount}개`;
  }
  if (progress.phase === 'importing') {
    return `성공 ${progress.current}개 / 실패 ${progress.failedCount}개 / 전체 ${progress.total}개, 현재: ${progress.title}`;
  }
  return `완료: ${progress.importedCount}개 불러옴, 실패 ${progress.failedCount}개`;
};

export function ProjectConversationImportModal({
  allFolderOptions,
  canRetryAllFailures,
  importError,
  failures,
  isBusy,
  isImporting,
  isOpen,
  mode,
  onClose,
  onParentFolderChange,
  onPreferredStrategyChange,
  onProjectUrlChange,
  onRetryAllFailures,
  onRetryFailure,
  onSubmit,
  onWorkerCountChange,
  parentFolderId,
  preferredStrategy,
  progress,
  projectUrl,
  syncSummary,
  workerCount,
}: ProjectConversationImportModalProps) {
  const isSyncMode = mode === 'sync';

  return (
    <Modal
      ariaLabelledBy="project-import-modal-title"
      eyebrow="프로젝트"
      isOpen={isOpen}
      onClose={isBusy ? () => undefined : onClose}
      title={isSyncMode ? '프로젝트 동기화' : '프로젝트 불러오기'}
    >
      <form className="modal__form" onSubmit={onSubmit}>
        <label className="modal__label" htmlFor="project-import-url">
          ChatGPT 프로젝트 URL
        </label>
        <input
          id="project-import-url"
          className="modal__input"
          type="url"
          placeholder="https://chatgpt.com/project/..."
          value={projectUrl}
          onChange={(event) => onProjectUrlChange(event.target.value)}
          autoFocus
          disabled={isImporting}
        />
        {!isSyncMode ? (
          <>
            <label className="modal__label" htmlFor="project-import-parent-folder">
              저장할 부모 폴더
            </label>
            <select
              id="project-import-parent-folder"
              className="modal__input modal__select"
              value={getFolderSelectValue(parentFolderId)}
              onChange={(event) =>
                onParentFolderChange(parseFolderSelectValue(event.target.value))
              }
              disabled={isImporting}
            >
              <option value={getFolderSelectValue(null)}>작업 공간 루트</option>
              {allFolderOptions.map((folderOption) => (
                <option key={folderOption.id} value={folderOption.id}>
                  {formatFolderOptionLabel(folderOption.name, folderOption.depth)}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <div className="modal__section">
          <div className="modal__section-header">
            <strong>선호 옵션</strong>
            <span>프로젝트 import와 동기화에 공통으로 사용됩니다.</span>
          </div>
          <label className="modal__label" htmlFor="project-import-worker-count">
            보조창 워커 수
          </label>
          <input
            id="project-import-worker-count"
            className="modal__input"
            type="number"
            min={1}
            max={20}
            step={1}
            value={workerCount}
            onChange={(event) => onWorkerCountChange(Number(event.target.value))}
            disabled={isImporting}
          />
          <label className="modal__label" htmlFor="project-import-preferred-strategy">
            우선 전략
          </label>
          <select
            id="project-import-preferred-strategy"
            className="modal__input modal__select"
            value={preferredStrategy}
            onChange={(event) =>
              onPreferredStrategyChange(
                event.target.value as ProjectConversationImportStrategyPreference,
              )
            }
            disabled={isImporting}
          >
            {PROJECT_CONVERSATION_IMPORT_STRATEGY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="modal__hint">
            원본 링크 우선은 로그인된 ChatGPT 대화 페이지를 먼저 직접 읽고,
            공유 링크 우선은 기존 공유 링크 갱신 경로를 먼저 시도합니다.
          </p>
        </div>
        <p className="modal__hint">
          {isSyncMode
            ? '프로젝트 채팅 목록을 다시 수집해서 현재 폴더의 대화와 비교하고, 누락된 대화만 가져옵니다.'
            : '프로젝트 URL을 입력하면 프로젝트 이름으로 폴더를 만들고, 프로젝트의 대화들을 순서대로 공유 링크로 변환해 그 아래에 넣습니다.'}
        </p>
        <p className="modal__hint">
          이 작업은 로그인된 ChatGPT 세션과 보조 자동화 창이 필요합니다.
        </p>
        {syncSummary ? (
          <div className="modal__section">
            <div className="modal__section-header">
              <strong>동기화 비교 결과</strong>
              <span>프로젝트 목록과 현재 폴더를 비교했습니다.</span>
            </div>
            <p className="modal__hint">프로젝트 목록 {syncSummary.collectedCount}개</p>
            <p className="modal__hint">이미 일치하는 대화 {syncSummary.matchedCount}개</p>
            <p className="modal__hint">추가로 가져올 대화 {syncSummary.missingCount}개</p>
            <p className="modal__hint">뷰어에서 생성으로 표시할 대화 {syncSummary.viewerCreatedCount}개</p>
          </div>
        ) : null}
        {progress ? <p className="modal__hint">{getProgressLabel(progress)}</p> : null}
        {importError ? (
          <p className="modal__error" role="alert">
            {importError}
          </p>
        ) : null}
        {failures.length > 0 ? (
          <div className="modal__failure-list" role="status" aria-live="polite">
            <div className="modal__section-header">
              <p className="modal__label">실패한 대화 {failures.length}개</p>
              <Button
                disabled={!canRetryAllFailures || isBusy}
                onClick={onRetryAllFailures}
                variant="secondary"
              >
                실패 전체 재시도
              </Button>
            </div>
            <ul className="modal__failure-items">
              {failures.map((failure) => (
                <li key={`${failure.chatUrl}-${failure.title}`} className="modal__failure-item">
                  <div className="modal__failure-item-main">
                    <strong>{failure.title}</strong>
                    <span className="modal__label-meta">
                      {failure.status === 'failed'
                        ? '재시도 3회 실패로 완전 실패'
                        : failure.status === 'retrying'
                          ? `재시도 ${failure.retryCount}/3 진행 중`
                          : failure.retryCount > 0
                            ? `재시도 ${failure.retryCount}/3 실패`
                            : '재시도 가능'}
                    </span>
                  </div>
                  <Button
                    className="modal__failure-action"
                    disabled={failure.status !== 'retryable' || isBusy}
                    onClick={() => onRetryFailure(failure.chatUrl)}
                    variant="secondary"
                  >
                    {failure.status === 'failed'
                      ? '완전 실패'
                      : failure.status === 'retrying'
                        ? '재시도 중...'
                        : failure.retryCount > 0
                          ? `재시도 (${failure.retryCount}/3)`
                          : '재시도'}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="modal__actions">
          <Button variant="secondary" onClick={onClose} disabled={isBusy}>
            취소
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={isImporting || !projectUrl.trim()}
          >
            {isImporting
              ? isSyncMode
                ? '동기화 중...'
                : '불러오는 중...'
              : isSyncMode
                ? '프로젝트 동기화'
                : '프로젝트 불러오기'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
