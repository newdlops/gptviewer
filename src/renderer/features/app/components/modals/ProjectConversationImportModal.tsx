import type { FormEvent } from 'react';
import { Button } from '../../../../components/ui/Button';
import { Modal } from '../../../../components/ui/Modal';

type ProjectConversationImportModalProps = {
  importError: string;
  isImporting: boolean;
  isOpen: boolean;
  onClose: () => void;
  onProjectUrlChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  projectUrl: string;
};

export function ProjectConversationImportModal({
  importError,
  isImporting,
  isOpen,
  onClose,
  onProjectUrlChange,
  onSubmit,
  projectUrl,
}: ProjectConversationImportModalProps) {
  return (
    <Modal
      ariaLabelledBy="project-import-modal-title"
      eyebrow="프로젝트"
      isOpen={isOpen}
      onClose={onClose}
      title="프로젝트 불러오기"
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
        <p className="modal__hint">
          프로젝트 URL을 입력하면 프로젝트 이름으로 루트 폴더를 만들고,
          프로젝트의 대화들을 순서대로 공유 링크로 변환해 그 아래에 넣습니다.
        </p>
        <p className="modal__hint">
          이 작업은 로그인된 ChatGPT 세션과 보조 자동화 창이 필요합니다.
        </p>
        {importError ? (
          <p className="modal__error" role="alert">
            {importError}
          </p>
        ) : null}
        <div className="modal__actions">
          <Button variant="secondary" onClick={onClose} disabled={isImporting}>
            취소
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={isImporting || !projectUrl.trim()}
          >
            {isImporting ? '불러오는 중...' : '프로젝트 불러오기'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
