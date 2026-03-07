import type { FormEvent } from 'react';
import { Button } from '../../../../components/ui/Button';
import { Modal } from '../../../../components/ui/Modal';
import { formatFolderOptionLabel } from '../../lib/appTypes';

type SharedConversationImportModalProps = {
  allFolderOptions: Array<{ depth: number; id: string; name: string }>;
  hasImportDestinationFolders: boolean;
  importChatUrl: string;
  importError: string;
  importFolderId: string;
  importProjectUrl: string;
  isImportModalOpen: boolean;
  isImportingSharedConversation: boolean;
  onChatUrlChange: (value: string) => void;
  onClose: () => void;
  onFolderChange: (value: string) => void;
  onProjectUrlChange: (value: string) => void;
  onShareUrlChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  shareUrl: string;
};

export function SharedConversationImportModal({
  allFolderOptions,
  hasImportDestinationFolders,
  importChatUrl,
  importError,
  importFolderId,
  importProjectUrl,
  isImportModalOpen,
  isImportingSharedConversation,
  onChatUrlChange,
  onClose,
  onFolderChange,
  onProjectUrlChange,
  onShareUrlChange,
  onSubmit,
  shareUrl,
}: SharedConversationImportModalProps) {
  return (
    <Modal
      ariaLabelledBy="shared-chat-modal-title"
      eyebrow="공유 대화"
      isOpen={isImportModalOpen}
      onClose={onClose}
      title="공유 링크 불러오기"
    >
      <form className="modal__form" onSubmit={onSubmit}>
        <label className="modal__label" htmlFor="shared-chat-url">공유 URL</label>
        <input
          id="shared-chat-url"
          className="modal__input"
          type="url"
          placeholder="https://chatgpt.com/share/..."
          value={shareUrl}
          onChange={(event) => onShareUrlChange(event.target.value)}
          autoFocus
          disabled={isImportingSharedConversation}
        />
        <label className="modal__label" htmlFor="shared-chat-folder">저장할 폴더</label>
        <select
          id="shared-chat-folder"
          className="modal__input"
          value={importFolderId}
          onChange={(event) => onFolderChange(event.target.value)}
          disabled={isImportingSharedConversation || !hasImportDestinationFolders}
        >
          <option value="" disabled>폴더를 선택해 주세요</option>
          {allFolderOptions.map((folderOption) => (
            <option key={folderOption.id} value={folderOption.id}>
              {formatFolderOptionLabel(folderOption.name, folderOption.depth)}
            </option>
          ))}
        </select>
        <label className="modal__label" htmlFor="shared-chat-origin-url">
          원본 ChatGPT 대화 URL
          <small className="modal__label-meta">선택 입력</small>
        </label>
        <input
          id="shared-chat-origin-url"
          className="modal__input"
          type="url"
          placeholder="https://chatgpt.com/c/..."
          value={importChatUrl}
          onChange={(event) => onChatUrlChange(event.target.value)}
          disabled={isImportingSharedConversation}
        />
        <label className="modal__label" htmlFor="shared-chat-project-url">
          원본 ChatGPT 프로젝트 URL
          <small className="modal__label-meta">프로젝트 대화인 경우만</small>
        </label>
        <input
          id="shared-chat-project-url"
          className="modal__input"
          type="url"
          placeholder="https://chatgpt.com/project/..."
          value={importProjectUrl}
          onChange={(event) => onProjectUrlChange(event.target.value)}
          disabled={isImportingSharedConversation}
        />
        <p className="modal__hint">공유 링크를 붙여 넣으면 대화 내용을 추출해 스트림으로 불러옵니다.</p>
        <p className="modal__hint">
          원본 ChatGPT 대화 URL까지 함께 넣으면 이후 새로고침 시 GPT 웹앱의 Share 흐름을 자동화할 수 있습니다.
          프로젝트 대화라면 프로젝트 URL도 같이 저장해 두세요.
        </p>
        {!hasImportDestinationFolders ? (
          <p className="modal__error" role="alert">공유 대화를 불러오려면 먼저 폴더를 하나 만들어 주세요.</p>
        ) : null}
        {importError ? <p className="modal__error" role="alert">{importError}</p> : null}
        <div className="modal__actions">
          <Button variant="secondary" onClick={onClose} disabled={isImportingSharedConversation}>취소</Button>
          <Button
            variant="primary"
            type="submit"
            disabled={isImportingSharedConversation || !hasImportDestinationFolders || !importFolderId || !shareUrl.trim()}
          >
            {isImportingSharedConversation ? '불러오는 중...' : '불러오기'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
