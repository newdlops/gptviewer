import type { FormEvent } from 'react';
import { Button } from '../../../../components/ui/Button';
import { Modal } from '../../../../components/ui/Modal';
import { WORKSPACE_ROOT_VALUE } from '../../../conversations/lib/workspaceTree';
import { formatFolderOptionLabel } from '../../lib/appTypes';
import {
  SHARED_CONVERSATION_IMPORT_STRATEGY_OPTIONS,
  type SharedConversationImportStrategyPreference,
} from '../../lib/sharedConversationImportPreferences';

type SharedConversationImportModalProps = {
  allFolderOptions: Array<{ depth: number; id: string; name: string }>;
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
  onPreferredStrategyChange: (
    value: SharedConversationImportStrategyPreference,
  ) => void;
  onShareUrlChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  preferredStrategy: SharedConversationImportStrategyPreference;
  shareUrl: string;
};

export function SharedConversationImportModal({
  allFolderOptions,
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
  onPreferredStrategyChange,
  onShareUrlChange,
  onSubmit,
  preferredStrategy,
  shareUrl,
}: SharedConversationImportModalProps) {
  const hasShareUrl = shareUrl.trim().length > 0;
  const hasChatUrl = importChatUrl.trim().length > 0;

  return (
    <Modal
      ariaLabelledBy="shared-chat-modal-title"
      eyebrow="대화"
      isOpen={isImportModalOpen}
      onClose={onClose}
      title="대화 불러오기"
    >
      <form className="modal__form" onSubmit={onSubmit}>
        <label className="modal__label" htmlFor="shared-chat-url">공유 대화 URL</label>
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
          disabled={isImportingSharedConversation}
        >
          <option value="" disabled>폴더를 선택해 주세요</option>
          <option value={WORKSPACE_ROOT_VALUE}>작업공간 루트</option>
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
        <label className="modal__label" htmlFor="shared-chat-preferred-strategy">
          불러오기 전략
        </label>
        <select
          id="shared-chat-preferred-strategy"
          className="modal__input"
          value={preferredStrategy}
          onChange={(event) =>
            onPreferredStrategyChange(
              event.target.value as SharedConversationImportStrategyPreference,
            )
          }
          disabled={isImportingSharedConversation}
        >
          {SHARED_CONVERSATION_IMPORT_STRATEGY_OPTIONS.map((option) => {
            const isDisabled =
              (option.value === 'share-url-first' && hasChatUrl && !hasShareUrl) ||
              (option.value === 'chat-url-first' && hasShareUrl && !hasChatUrl);

            return (
            <option key={option.value} value={option.value} disabled={isDisabled}>
              {option.label}
            </option>
            );
          })}
        </select>
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
        <p className="modal__hint">공유 대화 URL을 붙여 넣으면 대화 내용을 추출해 스트림으로 불러옵니다.</p>
        <p className="modal__hint">
          원본 ChatGPT 대화 URL까지 함께 넣으면 이후 새로고침 시 GPT 웹앱의 Share 흐름을 자동화할 수 있습니다.
          프로젝트 대화라면 프로젝트 URL도 같이 저장해 두세요.
        </p>
        <p className="modal__hint">
          원본 링크 우선은 로그인된 ChatGPT 대화 페이지를 먼저 직접 읽고, 실패하면 공유 대화 URL 기반 불러오기로 내려갑니다.
        </p>
        {importError ? <p className="modal__error" role="alert">{importError}</p> : null}
        <div className="modal__actions">
          <Button variant="secondary" onClick={onClose} disabled={isImportingSharedConversation}>취소</Button>
          <Button
            variant="primary"
            type="submit"
            disabled={
              isImportingSharedConversation ||
              !importFolderId ||
              (preferredStrategy === 'chat-url-first'
                ? !importChatUrl.trim()
                : !shareUrl.trim())
            }
          >
            {isImportingSharedConversation ? '불러오는 중...' : '불러오기'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
